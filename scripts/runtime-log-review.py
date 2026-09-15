#!/usr/bin/env python3
"""Read-only, user-triggered review of one installed MCP event database."""
import argparse
import collections
import datetime
import json
import math
import pathlib
import sqlite3

MEMORY_FIELDS = ('rss_bytes', 'heap_used_bytes', 'heap_total_bytes', 'external_bytes', 'array_buffers_bytes')
QUIET_FIELDS = ('active_requests', 'owned_processes', 'parser_active', 'parser_queued', 'lsp_active_requests')


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def latency_stats(timings):
    result = []
    for (tool, action, operation), values in sorted(timings.items(), key=lambda item: str(item[0])):
        values.sort()
        result.append({'tool': tool, 'action': action, 'operation': operation, 'n': len(values),
                       'p50_ms': values[math.ceil(len(values) * .5) - 1],
                       'p95_ms': values[math.ceil(len(values) * .95) - 1], 'max_ms': values[-1]})
    return result


def memory_stats(samples):
    result = []
    for instance, rows in samples.items():
        def series(values):
            metrics = {}
            for field in MEMORY_FIELDS:
                points = [row[field] for row in values if numeric(row.get(field))]
                if points:
                    metrics[field] = {'first': points[0], 'last': points[-1],
                                      'delta': points[-1] - points[0], 'peak': max(points)}
            return metrics

        first, last = rows[0], rows[-1]
        quiet = [row for row in rows if all(row.get(field) == 0 for field in QUIET_FIELDS)]
        result.append({'instance_id': instance, 'pid': first.get('pid'), 'thread_id': first.get('thread_id'),
                       'release': first.get('release'), 'n': len(rows),
                       'first_created_ms': first['created_ms'], 'last_created_ms': last['created_ms'],
                       'duration_ms': last['created_ms'] - first['created_ms'],
                       'reasons': dict(collections.Counter(row.get('reason') for row in rows)),
                       'sequence_gaps': sum(max(0, b.get('sequence', 0) - a.get('sequence', 0) - 1)
                                            for a, b in zip(rows, rows[1:])),
                       'failed_samples_lifetime': last.get('failed_samples'),
                       'memory': series(rows), 'quiet_n': len(quiet), 'quiet_memory': series(quiet),
                       'last_activity': {key: last.get(key) for key in (*QUIET_FIELDS, 'owned_listeners',
                                         'owned_connections', 'parser_workers', 'ui_cache_entries')}})
    return result


def review(state, after_event_id=0):
    state = pathlib.Path(state).resolve()
    db = sqlite3.connect((state / 'state.sqlite').as_uri() + '?mode=ro', uri=True)
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        maximum = db.execute('SELECT coalesce(max(id),0) FROM events').fetchone()[0]
        if maximum < after_event_id:
            raise ValueError('Cursor exceeds retained event IDs; verify state identity or reset explicitly.')
        counts, coverage = collections.Counter(), collections.Counter()
        failures, process_errors = [], []
        returned, failed = collections.defaultdict(list), collections.defaultdict(list)
        samples = collections.defaultdict(list)
        ui_calls, ui_returns, flow_workflows = collections.Counter(), collections.Counter(), collections.Counter()
        first = last = None
        releases = set()
        for event_id, kind, raw, created in db.execute(
                'SELECT id,kind,data,created FROM events WHERE id>? AND id<=? ORDER BY id', (after_event_id, maximum)):
            data = json.loads(raw)
            counts[kind] += 1
            first = created if first is None else first
            last = created
            if data.get('release'):
                releases.add(data['release'])
            timing_key = (data.get('tool'), data.get('action'), data.get('operation'))
            if kind == 'request_failed':
                failures.append({'event_id': event_id, 'created_ms': created,
                                 **{k: data.get(k) for k in ('tool', 'action', 'operation', 'code', 'elapsed_ms', 'instance_id')}})
            if kind in ('request_finish', 'request_failed'):
                bucket = 'returned' if kind == 'request_finish' else 'failed'
                timed = numeric(data.get('elapsed_ms'))
                coverage[f'{bucket}_{"timed" if timed else "without_elapsed"}'] += 1
                if timed:
                    (returned if kind == 'request_finish' else failed)[timing_key].append(data['elapsed_ms'])
            if kind == 'runtime_sample' and data.get('telemetry_version') == 1 and isinstance(data.get('instance_id'), str):
                samples[data['instance_id']].append({**data, 'created_ms': created})
            if kind == 'request_start':
                if data.get('tool') in ('ui_flow', 'ui_query', 'ui_control', 'ui_tap', 'ui_test', 'ui_snapshot', 'ui_inspect', 'ui_find', 'ui_observe'):
                    ui_calls[(data['tool'], data.get('action'), data.get('operation'))] += 1
                if data.get('tool') == 'workflow_run' and data.get('action') == 'start' and data.get('workflow') in ('ui_flow', 'ui_record'):
                    flow_workflows[data['workflow']] += 1
            if kind == 'request_finish' and data.get('tool') == 'ui_flow':
                ui_returns[(data.get('action'), data.get('outcome'), data.get('status'))] += 1
            if kind == 'process_finish' and (data.get('exitCode') != 0 or data.get('signal')):
                process_errors.append({'event_id': event_id, 'created_ms': created,
                                       **{k: data.get(k) for k in ('executable', 'exitCode', 'signal')},
                                       'artifact_id': data.get('log', {}).get('artifact_id')})
        return {'reviewed_at': datetime.datetime.now().astimezone().isoformat(),
                'state': str(state), 'after_event_id': after_event_id, 'through_event_id': maximum,
                'first_created_ms': first, 'last_created_ms': last, 'releases': sorted(releases), 'counts': dict(counts),
                'request_failures': failures, 'process_nonzero_or_signaled': process_errors,
                'returned_request_latency': latency_stats(returned), 'failed_request_latency': latency_stats(failed),
                'latency_coverage': dict(coverage),
                'ui_usage': {'calls': [{'tool': tool, 'action': action, 'operation': operation, 'n': count}
                                      for (tool, action, operation), count in sorted(ui_calls.items(), key=lambda item: str(item[0]))],
                             'flow_returns': [{'action': action, 'outcome': outcome, 'status': status, 'n': count}
                                              for (action, outcome, status), count in sorted(ui_returns.items(), key=lambda item: str(item[0]))],
                             'indirect_flow_workflow_starts': dict(flow_workflows)},
                'memory_instances': memory_stats(samples),
                'limitations': ['request_finish means returned, not business success; flow usage counts do not prove eligible replay opportunities or replay success',
                                'read referenced build artifacts for warnings and compiler errors',
                                'worker DB does not cover all host startup/transport errors or runtime_sample_failed stderr warnings',
                                'RSS covers one Node process; heap/external/array_buffers cover its sampled runtime Worker, not SDK children',
                                'quiet means no tracked request/process/parser/LSP activity, not forced GC or SDK quiescence; memory deltas alone do not prove a leak',
                                'samples run at startup, once per minute and before shutdown cleanup; at most 2880 across all instances, also subject to ordinary event retention',
                                'old runtime versions have no memory samples or failed elapsed times; no controlled performance comparison',
                                'incremental start/finish events may span review windows; retention can remove earlier events and samples']}
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=pathlib.Path, required=True)
    parser.add_argument('--after-event-id', type=int, default=0)
    args = parser.parse_args()
    if args.after_event_id < 0:
        parser.error('--after-event-id must be nonnegative')
    try:
        print(json.dumps(review(args.state, args.after_event_id), ensure_ascii=False, indent=2))
    except ValueError as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
