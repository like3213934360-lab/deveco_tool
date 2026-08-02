#!/usr/bin/env python3
"""Deterministic baseline scoring for UI reconstruction screenshots.

This script intentionally avoids external services. It normalizes paired images,
ignores top/bottom system information areas, computes reproducible visual
metrics, and writes JSON plus visual artifacts. A model should still inspect the
artifacts for semantic UI issues and final issue selection.
"""

from __future__ import annotations

import argparse
import html
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Iterable

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


def natural_key(path: Path) -> list[object]:
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", path.stem)]


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def load_rgb(path: Path) -> Image.Image:
    image = Image.open(path)
    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA"):
        background = Image.new("RGB", image.size, "white")
        background.paste(image, mask=image.getchannel("A"))
        return background
    return image.convert("RGB")


def resize_to_width(image: Image.Image, width: int) -> Image.Image:
    if image.width == width:
        return image.copy()
    height = max(1, round(image.height * width / image.width))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def downsample_for_metric(a: Image.Image, b: Image.Image, max_width: int = 320) -> tuple[Image.Image, Image.Image]:
    if a.width <= max_width:
        return a, b
    height = max(1, round(a.height * max_width / a.width))
    size = (max_width, height)
    return a.resize(size, Image.Resampling.BILINEAR), b.resize(size, Image.Resampling.BILINEAR)


def global_ssim_gray(a: Image.Image, b: Image.Image) -> float:
    a, b = downsample_for_metric(a.convert("L"), b.convert("L"))
    data_a = list(a.getdata())
    data_b = list(b.getdata())
    n = len(data_a)
    if n < 2:
        return 0.0
    mean_a = sum(data_a) / n
    mean_b = sum(data_b) / n
    var_a = sum((x - mean_a) ** 2 for x in data_a) / (n - 1)
    var_b = sum((x - mean_b) ** 2 for x in data_b) / (n - 1)
    cov = sum((data_a[i] - mean_a) * (data_b[i] - mean_b) for i in range(n)) / (n - 1)
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2
    denom = (mean_a * mean_a + mean_b * mean_b + c1) * (var_a + var_b + c2)
    if denom == 0:
        return 1.0 if data_a == data_b else 0.0
    return ((2 * mean_a * mean_b + c1) * (2 * cov + c2)) / denom


def mean_abs_error(a: Image.Image, b: Image.Image) -> float:
    a, b = downsample_for_metric(a.convert("RGB"), b.convert("RGB"))
    diff = ImageChops.difference(a, b)
    pixels = list(diff.getdata())
    return sum(sum(pixel) for pixel in pixels) / (len(pixels) * 3)


def average_rgb(image: Image.Image) -> tuple[int, int, int]:
    return image.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))


def rgb_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def crop_compare_area(
    a: Image.Image,
    b: Image.Image,
    ignore_top_px: int,
    ignore_bottom_px: int,
) -> tuple[Image.Image, Image.Image]:
    width = min(a.width, b.width)
    height = min(a.height, b.height)
    top = min(max(0, ignore_top_px), max(0, height - 1))
    bottom = max(top + 1, height - max(0, ignore_bottom_px))
    return a.crop((0, top, width, bottom)), b.crop((0, top, width, bottom))


def band_slices(height: int) -> list[tuple[str, int, int]]:
    bands = [
        ("top_app", 0.00, 0.18),
        ("upper_content", 0.18, 0.38),
        ("middle_content", 0.38, 0.66),
        ("lower_content", 0.66, 0.86),
        ("bottom_area", 0.86, 1.00),
    ]
    result = []
    for name, start, end in bands:
        y0 = int(height * start)
        y1 = max(y0 + 1, int(height * end))
        result.append((name, y0, min(height, y1)))
    return result


def edge_image(image: Image.Image) -> Image.Image:
    return image.convert("L").filter(ImageFilter.FIND_EDGES)


def make_heatmap(reference: Image.Image, candidate: Image.Image, ignore_top_px: int, ignore_bottom_px: int) -> Image.Image:
    width = min(reference.width, candidate.width)
    height = min(reference.height, candidate.height)
    ref = reference.crop((0, 0, width, height))
    cand = candidate.crop((0, 0, width, height))
    diff = ImageChops.difference(ref, cand).convert("L")
    if ignore_top_px > 0:
        draw = ImageDraw.Draw(diff)
        draw.rectangle((0, 0, width, min(ignore_top_px, height)), fill=0)
    if ignore_bottom_px > 0:
        draw = ImageDraw.Draw(diff)
        draw.rectangle((0, max(0, height - ignore_bottom_px), width, height), fill=0)
    diff = ImageEnhance.Contrast(diff).enhance(3.0)
    base = Image.blend(ref, cand, 0.5).convert("RGBA")
    overlay = Image.new("RGBA", (width, height), (255, 0, 0, 0))
    alpha = diff.point(lambda p: min(210, int(p * 1.2)))
    overlay.putalpha(alpha)
    return Image.alpha_composite(base, overlay).convert("RGB")


def edge_density(image: Image.Image) -> float:
    if image.width <= 0 or image.height <= 0:
        return 0.0
    edges = edge_image(image).resize((min(240, image.width), max(1, round(image.height * min(240, image.width) / image.width))), Image.Resampling.BILINEAR)
    pixels = list(edges.getdata())
    return sum(1 for p in pixels if p > 32) / max(1, len(pixels))


def system_area_diagnostics(
    ref_norm: Image.Image,
    cand_norm: Image.Image,
    ignore_top_px: int,
    ignore_bottom_px: int,
) -> dict:
    width = min(ref_norm.width, cand_norm.width)
    height = min(ref_norm.height, cand_norm.height)
    top_h = min(max(0, ignore_top_px), height)
    bottom_h = min(max(0, ignore_bottom_px), height)
    diagnostics = {
        "top_ignored_height": top_h,
        "bottom_ignored_height": bottom_h,
        "top_candidate_edge_density": 0.0,
        "top_reference_edge_density": 0.0,
        "top_edge_density_delta": 0.0,
        "bottom_candidate_edge_density": 0.0,
        "bottom_reference_edge_density": 0.0,
        "bottom_edge_density_delta": 0.0,
        "top_overlap_risk": "unknown",
        "bottom_gesture_or_bar_delta_risk": "unknown",
    }
    if top_h > 0:
        ref_top = ref_norm.crop((0, 0, width, top_h))
        cand_top = cand_norm.crop((0, 0, width, top_h))
        ref_density = edge_density(ref_top)
        cand_density = edge_density(cand_top)
        diagnostics["top_candidate_edge_density"] = round(cand_density, 4)
        diagnostics["top_reference_edge_density"] = round(ref_density, 4)
        diagnostics["top_edge_density_delta"] = round(cand_density - ref_density, 4)
        if cand_density > 0.11 and cand_density - ref_density > 0.035:
            diagnostics["top_overlap_risk"] = "high"
        elif cand_density > 0.08 and cand_density - ref_density > 0.02:
            diagnostics["top_overlap_risk"] = "medium"
        else:
            diagnostics["top_overlap_risk"] = "low"
    if bottom_h > 0:
        ref_bottom = ref_norm.crop((0, height - bottom_h, width, height))
        cand_bottom = cand_norm.crop((0, height - bottom_h, width, height))
        ref_density = edge_density(ref_bottom)
        cand_density = edge_density(cand_bottom)
        diagnostics["bottom_candidate_edge_density"] = round(cand_density, 4)
        diagnostics["bottom_reference_edge_density"] = round(ref_density, 4)
        diagnostics["bottom_edge_density_delta"] = round(cand_density - ref_density, 4)
        if abs(cand_density - ref_density) > 0.05:
            diagnostics["bottom_gesture_or_bar_delta_risk"] = "medium"
        else:
            diagnostics["bottom_gesture_or_bar_delta_risk"] = "low"
    return diagnostics


def draw_label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str) -> None:
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
    except Exception:
        font = ImageFont.load_default()
    draw.text(xy, text, fill=(20, 20, 20), font=font)


def make_side_by_side(reference: Image.Image, candidate: Image.Image, heatmap: Image.Image, title: str) -> Image.Image:
    thumb_w = 260
    max_h = 560
    images = []
    for source in (reference, candidate, heatmap):
        im = source.copy()
        im.thumbnail((thumb_w, max_h), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (thumb_w, max_h), "white")
        canvas.paste(im, ((thumb_w - im.width) // 2, 0))
        images.append(canvas)
    gutter = 18
    header = 54
    out = Image.new("RGB", (thumb_w * 3 + gutter * 4, max_h + header), (245, 245, 245))
    draw = ImageDraw.Draw(out)
    draw_label(draw, (gutter, 10), title)
    labels = ["reference", "candidate", "heatmap"]
    for i, im in enumerate(images):
        x = gutter + i * (thumb_w + gutter)
        draw_label(draw, (x, 32), labels[i])
        out.paste(im, (x, header))
    return out


@dataclass
class Pair:
    pair_id: str
    reference: Path
    candidate: Path


def list_image_files(path: Path) -> list[Path]:
    return sorted([p for p in path.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS], key=natural_key)


def collect_pairs(reference: Path, candidate: Path) -> list[Pair]:
    if reference.is_file() and candidate.is_file():
        return [Pair(reference.stem, reference, candidate)]
    if not reference.is_dir() or not candidate.is_dir():
        raise SystemExit("reference and candidate must both be files or both be directories")
    refs = list_image_files(reference)
    cands = {p.stem: p for p in list_image_files(candidate)}
    pairs = []
    for ref in refs:
        cand = cands.get(ref.stem)
        if cand:
            pairs.append(Pair(ref.stem, ref, cand))
    if not pairs:
        raise SystemExit("no paired images found by filename stem")
    return pairs


def score_from_metrics(ssim: float, edge_ssim: float, color_dist: float, mae: float, height_delta_ratio: float) -> float:
    ssim_score = clamp((ssim + 1) * 50)
    edge_score = clamp((edge_ssim + 1) * 50)
    color_score = clamp(100 - color_dist * 1.1)
    mae_score = clamp(100 - mae * 1.25)
    height_score = clamp(100 - height_delta_ratio * 180)
    return round(
        ssim_score * 0.34
        + edge_score * 0.22
        + color_score * 0.16
        + mae_score * 0.16
        + height_score * 0.12,
        1,
    )


def score_visual_only(ssim: float, edge_ssim: float, color_dist: float, mae: float) -> float:
    ssim_score = clamp((ssim + 1) * 50)
    edge_score = clamp((edge_ssim + 1) * 50)
    color_score = clamp(100 - color_dist * 1.1)
    mae_score = clamp(100 - mae * 1.25)
    return round(ssim_score * 0.38 + edge_score * 0.28 + color_score * 0.17 + mae_score * 0.17, 1)


def fit_scaled_to_size(image: Image.Image, size: tuple[int, int], scale: float, anchor: str) -> Image.Image:
    target_w, target_h = size
    scaled_w = max(1, round(image.width * scale))
    scaled_h = max(1, round(image.height * scale))
    scaled = image.resize((scaled_w, scaled_h), Image.Resampling.BILINEAR)
    bg = average_rgb(image)
    canvas = Image.new("RGB", size, bg)
    x = (target_w - scaled_w) // 2
    if anchor == "top":
        y = 0
    elif anchor == "bottom":
        y = target_h - scaled_h
    else:
        y = (target_h - scaled_h) // 2

    src_left = max(0, -x)
    src_top = max(0, -y)
    dst_left = max(0, x)
    dst_top = max(0, y)
    paste_w = min(target_w - dst_left, scaled_w - src_left)
    paste_h = min(target_h - dst_top, scaled_h - src_top)
    if paste_w > 0 and paste_h > 0:
        crop = scaled.crop((src_left, src_top, src_left + paste_w, src_top + paste_h))
        canvas.paste(crop, (dst_left, dst_top))
    return canvas


def scale_tolerant_score(reference: Image.Image, candidate: Image.Image) -> dict:
    """Find a small uniform candidate scale that best matches the reference.

    This is not a final UI judgment. It is a hint that a low raw score may be
    caused by global resolution/scale rather than broken layout.
    """
    scales = [0.88, 0.92, 0.96, 1.0, 1.04, 1.08, 1.12]
    anchors = ["top", "center", "bottom"]
    best = None
    ref_metric, cand_metric = downsample_for_metric(reference, candidate, max_width=160)
    ref_size = ref_metric.size
    for scale in scales:
        for anchor in anchors:
            rendered = fit_scaled_to_size(cand_metric, ref_size, scale, anchor)
            ssim = global_ssim_gray(ref_metric, rendered)
            edge_ssim = global_ssim_gray(edge_image(ref_metric), edge_image(rendered))
            mae = mean_abs_error(ref_metric, rendered)
            color_dist = rgb_distance(average_rgb(ref_metric), average_rgb(rendered))
            score = score_visual_only(ssim, edge_ssim, color_dist, mae)
            item = {
                "score": score,
                "scale": scale,
                "anchor": anchor,
                "ssim": round(ssim, 4),
                "edge_ssim": round(edge_ssim, 4),
                "mean_abs_error": round(mae, 2),
                "average_color_distance": round(color_dist, 2),
            }
            if best is None or item["score"] > best["score"]:
                best = item
    return best or {
        "score": 0.0,
        "scale": 1.0,
        "anchor": "center",
        "ssim": 0.0,
        "edge_ssim": 0.0,
        "mean_abs_error": 255.0,
        "average_color_distance": 255.0,
    }


def issue_hints(metrics: dict) -> list[dict]:
    hints = []
    bands = metrics["band_metrics"]
    bottom = bands.get("bottom_area", {})
    top = bands.get("top_app", {})
    system = metrics.get("system_area_diagnostics", {})
    scale_gain = metrics.get("scale_tolerant_baseline_score", 0) - metrics.get("deterministic_baseline_score", 0)
    scale_explains_delta = metrics.get("scale_delta_ignored_in_final_score", False)
    if scale_gain > 8:
        best = metrics.get("scale_tolerant_best_match", {})
        hints.append(
            {
                "type": "possible_global_scale_delta",
                "area": "overall screenshot scale",
                "hint": f"Scale-tolerant score is higher using candidate scale {best.get('scale', 1.0)} anchored {best.get('anchor', 'center')}; global resolution/scale differences were ignored for the final baseline score unless they cause a concrete layout failure.",
                "severity": "info",
            }
        )
    if metrics["normalized_height_delta_ratio"] > 0.08:
        hints.append(
            {
                "type": "viewport_or_content_height_delta",
                "area": "overall content height",
                "hint": "The normalized screenshots have noticeably different heights; inspect viewport height, safe-area handling, or scroll/crop state.",
                "severity": "medium",
            }
        )
    if bottom and bottom.get("ssim_score", 100) < 55 and not scale_explains_delta:
        hints.append(
            {
                "type": "bottom_region_mismatch",
                "area": "bottom fixed area or bottom sheet",
                "hint": "The bottom band has a high visual difference; inspect bottom anchoring, bottom navigation, sheet position, or safe-area spacing.",
                "severity": "high",
            }
        )
    if top and top.get("ssim_score", 100) < 55 and not scale_explains_delta:
        hints.append(
            {
                "type": "top_region_mismatch",
                "area": "app header or top content",
                "hint": "The top app band differs after ignoring the status bar; inspect header, top overlay, search/tabs, or hero media positioning.",
                "severity": "medium",
            }
        )
    if system.get("top_overlap_risk") in ("medium", "high"):
        hints.append(
            {
                "type": "top_system_area_overlap_risk",
                "area": "ignored top status/system area",
                "hint": "The top ignored system area has extra edge density versus the reference; inspect whether app title, back button, search, card, avatar, or other foreground components overlap the real status bar. This area is excluded from score but must be reviewed as a safe-area defect.",
                "severity": "high" if system.get("top_overlap_risk") == "high" else "medium",
            }
        )
    if metrics["average_color_distance"] > 35:
        hints.append(
            {
                "type": "visual_style_delta",
                "area": "overall visual style",
                "hint": "Average color/brightness differs strongly; inspect background color, overlay opacity, gradient, blur, or image brightness.",
                "severity": "medium",
            }
        )
    return hints[:4]


def compare_pair(
    pair: Pair,
    out_dir: Path,
    profile: str,
    target_width: int | None,
    ignore_top_px: int,
    ignore_bottom_px: int,
) -> dict:
    ref_original = load_rgb(pair.reference)
    cand_original = load_rgb(pair.candidate)
    width = target_width or ref_original.width
    ref_norm = resize_to_width(ref_original, width)
    cand_norm = resize_to_width(cand_original, width)

    compare_ref, compare_cand = crop_compare_area(ref_norm, cand_norm, ignore_top_px, ignore_bottom_px)
    common_height = compare_ref.height
    system_diagnostics = system_area_diagnostics(ref_norm, cand_norm, ignore_top_px, ignore_bottom_px)

    ssim = global_ssim_gray(compare_ref, compare_cand)
    edge_ssim = global_ssim_gray(edge_image(compare_ref), edge_image(compare_cand))
    mae = mean_abs_error(compare_ref, compare_cand)
    ref_rgb = average_rgb(compare_ref)
    cand_rgb = average_rgb(compare_cand)
    color_dist = rgb_distance(ref_rgb, cand_rgb)
    height_delta_ratio = abs(ref_norm.height - cand_norm.height) / max(ref_norm.height, 1)

    band_metrics = {}
    for name, y0, y1 in band_slices(common_height):
        rb = compare_ref.crop((0, y0, compare_ref.width, y1))
        cb = compare_cand.crop((0, y0, compare_cand.width, y1))
        bs = global_ssim_gray(rb, cb)
        be = global_ssim_gray(edge_image(rb), edge_image(cb))
        band_metrics[name] = {
            "y_range_after_ignored_top": [y0, y1],
            "ssim": round(bs, 4),
            "ssim_score": round(clamp((bs + 1) * 50), 1),
            "edge_ssim": round(be, 4),
            "edge_score": round(clamp((be + 1) * 50), 1),
            "mae": round(mean_abs_error(rb, cb), 2),
        }

    score = score_from_metrics(ssim, edge_ssim, color_dist, mae, height_delta_ratio)
    scale_score = scale_tolerant_score(compare_ref, compare_cand)
    scale_tolerant_baseline = max(score, scale_score["score"])
    scale_gain = scale_tolerant_baseline - score
    scale_delta_ignored = scale_gain > 8 and abs(scale_score["scale"] - 1.0) >= 0.035
    final_baseline_score = scale_tolerant_baseline
    pair_out = out_dir / "pairs" / pair.pair_id
    pair_out.mkdir(parents=True, exist_ok=True)
    ref_path = pair_out / "reference.normalized.png"
    cand_path = pair_out / "candidate.normalized.png"
    heatmap_path = pair_out / "diff_heatmap.png"
    side_path = pair_out / "side_by_side.jpg"
    ref_norm.save(ref_path)
    cand_norm.save(cand_path)
    heatmap = make_heatmap(ref_norm, cand_norm, ignore_top_px, ignore_bottom_px)
    heatmap.save(heatmap_path)
    make_side_by_side(ref_norm, cand_norm, heatmap, f"{pair.pair_id}: {pair.reference.name} vs {pair.candidate.name}").save(side_path, quality=92)

    metrics = {
        "id": pair.pair_id,
        "profile": profile,
        "reference": str(pair.reference),
        "candidate": str(pair.candidate),
        "reference_size": [ref_original.width, ref_original.height],
        "candidate_size": [cand_original.width, cand_original.height],
        "normalized_width": width,
        "reference_normalized_size": [ref_norm.width, ref_norm.height],
        "candidate_normalized_size": [cand_norm.width, cand_norm.height],
        "ignored_top_status_px": ignore_top_px,
        "ignored_bottom_system_px": ignore_bottom_px,
        "common_compared_height_after_ignored_system_areas": common_height,
        "system_area_diagnostics": system_diagnostics,
        "ssim": round(ssim, 4),
        "edge_ssim": round(edge_ssim, 4),
        "mean_abs_error": round(mae, 2),
        "average_rgb_reference": list(ref_rgb),
        "average_rgb_candidate": list(cand_rgb),
        "average_color_distance": round(color_dist, 2),
        "normalized_height_delta_ratio": round(height_delta_ratio, 4),
        "deterministic_baseline_score": score,
        "scale_tolerant_baseline_score": scale_tolerant_baseline,
        "scale_tolerant_best_match": scale_score,
        "scale_delta_ignored_in_final_score": scale_delta_ignored,
        "final_baseline_score": final_baseline_score,
        "band_metrics": band_metrics,
        "issue_hints": [],
        "artifacts": {
            "reference_normalized": str(ref_path),
            "candidate_normalized": str(cand_path),
            "diff_heatmap": str(heatmap_path),
            "side_by_side": str(side_path),
        },
    }
    metrics["issue_hints"] = issue_hints(metrics)
    with (pair_out / "metrics.json").open("w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)
    return metrics


def write_contact_sheet(results: list[dict], out_dir: Path) -> Path:
    thumbs = []
    for result in results:
        image = Image.open(result["artifacts"]["side_by_side"]).convert("RGB")
        image.thumbnail((760, 360), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (780, 390), (250, 250, 250))
        canvas.paste(image, (10, 26))
        draw = ImageDraw.Draw(canvas)
        draw_label(draw, (10, 5), f"{result['id']} final {result['final_baseline_score']}")
        thumbs.append(canvas)
    cols = 1
    rows = len(thumbs)
    sheet = Image.new("RGB", (780 * cols, 390 * rows), (238, 238, 238))
    for idx, thumb in enumerate(thumbs):
        sheet.paste(thumb, (0, idx * 390))
    path = out_dir / "contact_sheet.jpg"
    sheet.save(path, quality=92)
    return path


def write_html(results: list[dict], out_dir: Path, contact_sheet: Path) -> None:
    def rel(path_text: str | Path) -> str:
        path = Path(path_text)
        try:
            return str(path.resolve().relative_to(out_dir.resolve()))
        except Exception:
            return str(path)

    rows = []
    for r in results:
        hints = "<br>".join(html.escape(h["hint"]) for h in r.get("issue_hints", [])) or "None"
        side = rel(r["artifacts"]["side_by_side"])
        heatmap = rel(r["artifacts"]["diff_heatmap"])
        rows.append(
            f"<tr>"
            f"<td>{html.escape(r['id'])}</td>"
            f"<td>{r['final_baseline_score']}</td>"
            f"<td>{r['deterministic_baseline_score']}</td>"
            f"<td>{r['scale_tolerant_baseline_score']}</td>"
            f"<td>{r['ssim']}</td>"
            f"<td>{r['edge_ssim']}</td>"
            f"<td>{r['average_color_distance']}</td>"
            f"<td>{hints}</td>"
            f"<td><a href='{html.escape(side)}'>side</a> "
            f"<a href='{html.escape(heatmap)}'>heatmap</a></td>"
            f"</tr>"
        )
    doc = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>UI Reconstruction Score Report</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #111; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th, td {{ border-bottom: 1px solid #ddd; padding: 8px; vertical-align: top; text-align: left; }}
    th {{ background: #f5f5f5; }}
    img {{ max-width: 100%; height: auto; border: 1px solid #ddd; }}
    .note {{ color: #555; max-width: 860px; }}
  </style>
</head>
<body>
  <h1>UI Reconstruction Score Report</h1>
  <p class="note">Top phone status information and bottom gesture/system indicator areas are ignored in metrics. System-area diagnostics are evidence for overlap/safe-area review, not pixel-score penalties. Use this report as deterministic evidence; final UI issues should be selected by semantic inspection and capped at two.</p>
  <p><a href="{html.escape(rel(contact_sheet))}">Contact sheet</a> · <a href="score.json">score.json</a></p>
  <table>
    <thead>
      <tr><th>ID</th><th>Final</th><th>Raw Baseline</th><th>Scale-Tolerant</th><th>SSIM</th><th>Edge</th><th>Color Δ</th><th>Hints</th><th>Artifacts</th></tr>
    </thead>
    <tbody>
      {''.join(rows)}
    </tbody>
  </table>
</body>
</html>
"""
    (out_dir / "index.html").write_text(doc, encoding="utf-8")


def aggregate(results: list[dict], profile: str, ignore_top_px: int, ignore_bottom_px: int) -> dict:
    return {
        "profile": profile,
        "ignored_top_status_px": ignore_top_px,
        "ignored_bottom_system_px": ignore_bottom_px,
        "pair_count": len(results),
        "aggregate": {
            "final_baseline_score": round(mean(r["final_baseline_score"] for r in results), 1),
            "deterministic_baseline_score": round(mean(r["deterministic_baseline_score"] for r in results), 1),
            "scale_tolerant_baseline_score": round(mean(r["scale_tolerant_baseline_score"] for r in results), 1),
            "ssim": round(mean(r["ssim"] for r in results), 4),
            "edge_ssim": round(mean(r["edge_ssim"] for r in results), 4),
            "average_color_distance": round(mean(r["average_color_distance"] for r in results), 2),
        },
        "pairs": results,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare UI design/reference screenshots with implementation/candidate screenshots.")
    parser.add_argument("reference", type=Path, help="reference image or directory")
    parser.add_argument("candidate", type=Path, help="candidate image or directory")
    parser.add_argument("--out", type=Path, default=Path("ui_score_report"), help="output report directory")
    parser.add_argument("--profile", default="mobile-app", help="profile label for report metadata")
    parser.add_argument("--target-width", type=int, default=None, help="logical width for normalization; defaults to each reference width")
    parser.add_argument("--ignore-top-px", type=int, default=44, help="logical top status/system area to ignore after normalization")
    parser.add_argument("--ignore-bottom-px", type=int, default=36, help="logical bottom gesture/system area to ignore after normalization")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    pairs = collect_pairs(args.reference, args.candidate)
    results = [
        compare_pair(pair, args.out, args.profile, args.target_width, args.ignore_top_px, args.ignore_bottom_px)
        for pair in pairs
    ]
    contact_sheet = write_contact_sheet(results, args.out)
    report = aggregate(results, args.profile, args.ignore_top_px, args.ignore_bottom_px)
    with (args.out / "score.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    write_html(results, args.out, contact_sheet)
    print(json.dumps({"out": str(args.out), "pair_count": len(results), "score": report["aggregate"]["final_baseline_score"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
