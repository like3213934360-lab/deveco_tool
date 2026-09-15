import hashlib
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('runtime_log_review', pathlib.Path(__file__).resolve().parents[1] / 'scripts/runtime-log-review.py')
reviewer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reviewer)


class RuntimeLogReviewTest(unittest.TestCase):
    def test_mixed_old_and_new_logs_separate_failed_latency_and_flow_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            state = pathlib.Path(directory)
            db = sqlite3.connect(state / 'state.sqlite')
            db.execute('CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, data TEXT, created INTEGER)')
            events = [
                ('request_start', {'tool': 'ui_flow', 'action': 'run'}),
                ('request_finish', {'tool': 'ui_flow', 'action': 'run', 'elapsed_ms': 3, 'outcome': 'pending', 'status': 'needs_input'}),
                ('request_start', {'tool': 'ui_control', 'operation': 'click'}),
                ('request_failed', {'tool': 'ui_control', 'operation': 'click', 'code': 'UI_TARGET_AMBIGUOUS'}),
                ('request_failed', {'tool': 'lsp', 'action': 'documentSymbol', 'code': 'CANCELLED', 'elapsed_ms': 12.5}),
                ('request_start', {'tool': 'workflow_run', 'action': 'start', 'workflow': 'ui_record'}),
                ('request_finish', {'tool': 'ui_control', 'operation': 'click', 'elapsed_ms': 7}),
            ]
            for kind, data in events:
                db.execute('INSERT INTO events(kind,data,created) VALUES(?,?,?)', (kind, json.dumps(data), 100))
            db.commit()
            db.close()
            before = hashlib.sha256((state / 'state.sqlite').read_bytes()).hexdigest()
            result = reviewer.review(state)
            self.assertEqual(result['latency_coverage'], {'returned_timed': 2, 'failed_without_elapsed': 1, 'failed_timed': 1})
            self.assertEqual(result['failed_request_latency'][0]['p50_ms'], 12.5)
            self.assertEqual(result['returned_request_latency'][0]['operation'], 'click')
            self.assertEqual(result['ui_usage']['indirect_flow_workflow_starts'], {'ui_record': 1})
            self.assertEqual(result['ui_usage']['flow_returns'], [{'action': 'run', 'outcome': 'pending', 'status': 'needs_input', 'n': 1}])
            self.assertEqual(result['memory_instances'], [])
            self.assertEqual(reviewer.review(state, result['through_event_id'])['counts'], {})
            with self.assertRaises(ValueError):
                reviewer.review(state, result['through_event_id'] + 1)
            self.assertEqual(hashlib.sha256((state / 'state.sqlite').read_bytes()).hexdigest(), before)

    def test_memory_series_do_not_mix_instances_with_reused_pid_or_busy_and_quiet_samples(self):
        def sample(instance, sequence, memory, busy=0):
            return {**{field: 0 for field in reviewer.QUIET_FIELDS}, 'instance_id': instance, 'pid': 100,
                    'sequence': sequence, 'created_ms': sequence * 60000, 'active_requests': busy,
                    'reason': 'interval', 'failed_samples': 1, 'rss_bytes': memory, 'heap_used_bytes': memory // 2}

        rows = reviewer.memory_stats({'first': [sample('first', 1, 100), sample('first', 2, 200, 1), sample('first', 4, 120)],
                                      'second': [sample('second', 1, 1000)]})
        first, second = rows
        self.assertEqual(first['memory']['rss_bytes'], {'first': 100, 'last': 120, 'delta': 20, 'peak': 200})
        self.assertEqual(first['quiet_memory']['rss_bytes']['peak'], 120)
        self.assertEqual(first['quiet_n'], 2)
        self.assertEqual(first['sequence_gaps'], 1)
        self.assertEqual(second['memory']['rss_bytes']['delta'], 0)
        self.assertEqual(second['memory']['rss_bytes']['first'], 1000)
        for invalid in (None, '12', True, float('nan'), -1):
            self.assertFalse(reviewer.numeric(invalid))


if __name__ == '__main__':
    unittest.main()
