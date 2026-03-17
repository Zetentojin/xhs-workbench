#!/usr/bin/env python3
"""Fetch, enrich, rerank, and brief Xiaohongshu search results."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote


def _resolve_cli_path(env_key: str, program_name: str, fallback_path: Path | None = None) -> Path | None:
    configured = os.environ.get(env_key)
    if configured:
        return Path(configured).expanduser()
    discovered = shutil.which(program_name)
    if discovered:
        return Path(discovered)
    return fallback_path


XHS_BIN = _resolve_cli_path("XHS_BIN", "xhs", Path.home() / ".local" / "bin" / "xhs")
OPENCLAW_BIN = _resolve_cli_path("OPENCLAW_BIN", "openclaw")
DEFAULT_KEYWORDS = ["AI", "投资", "创业", "VC", "风投"]
DEFAULT_GOAL = "寻找 AI 投资 / AI 创业 / VC 观点 / 优质创业者与投资人线索"
DEFAULT_BATCH_SIZE = 10
FOUNDER_DISCOVERY_KEYWORDS = [
    "独立开发者",
    "创业者",
    "AI创业",
    "创业复盘",
    "独立开发",
    "build in public",
    "产品上线",
    "发布上线",
    "做了个",
    "内测",
    "公测",
    "demo",
    "MVP",
    "招合伙人",
    "找技术合伙人",
    "找产品合伙人",
    "联创",
    "寻联创",
    "从0到1",
    "第一个用户",
    "找到第一个客户",
    "用户访谈",
    "拖延 app",
    "ADHD 工具",
    "健康管理 内测",
    "睡眠 工具",
    "知识管理 上线",
    "播客摘要 工具",
    "宠物友好 地图",
    "出海 第一个客户",
    "面试准备 工具",
    "招人",
    "天使轮",
    "种子轮",
    "融资复盘",
    "商业模式",
    "SaaS",
    "Agent",
    "出海创业",
    "用户增长",
    "付费用户",
    "签约客户",
    "营收",
    "PMF",
    "创业中",
    "一人公司",
    "辞职创业",
]
FOUNDER_GOAL = "寻找值得投资人跟进的创业者、潜在项目线索、早期团队和强产品信号"
XHS_CMD_TIMEOUT = 45
OPENCLAW_TIMEOUT = 90
PROFILE_CMD_TIMEOUT = 30
NOTE_DETAIL_LIMIT = 80
AUTHOR_SCAN_LIMIT = 12

FOUNDER_BIAS_TERMS = [
    "独立开发", "独立开发者", "联创", "联合创始人", "找合伙人", "招合伙人", "build in public",
    "bip", "从0到1", "做了个", "上线了", "刚上线", "内测", "公测", "邀测", "demo", "mvp",
    "第一个用户", "第一个客户", "冷启动", "复盘", "用户访谈", "留存", "付费率", "mrr", "arr",
    "pmf", "听劝开发", "评论区共创",
]
PROBLEM_BIAS_TERMS = [
    "拖延", "adhd", "专注", "计划", "维生素d", "作息", "饮食记录", "健康管理", "体重",
    "调酒", "咖啡", "健身", "冥想", "睡眠", "面试准备", "简历优化", "求职效率", "出海",
    "海外营销", "跨境内容", "知识管理", "播客摘要", "阅读辅助", "宠物友好", "地图", "焦虑",
    "压力", "拍照", "修图", "穿搭工具",
]
INVESTOR_SOLICIT_TERMS = [
    "我们投什么", "投资人", "欢迎bp", "项目来聊", "有想法的创始人来", "单笔", "pre-seed到seed",
    "可投", "看bp", "投500", "投融资", "创投圈", "资本视角",
]
PROMO_FILTER_TERMS = [
    "收徒", "陪跑", "资料领取", "免费送模板", "私信我", "主页看置顶", "引流", "训练营",
    "社群", "变现课", "矩阵号", "流量打法", "一键复刻", "接商单", "代运营",
]
EXTERNAL_PROOF_PATTERNS = [
    (re.compile(r"github", re.IGNORECASE), "github"),
    (re.compile(r"testflight", re.IGNORECASE), "testflight"),
    (re.compile(r"app store", re.IGNORECASE), "app_store"),
    (re.compile(r"waitlist", re.IGNORECASE), "waitlist"),
    (re.compile(r"邀请码"), "invite_code"),
    (re.compile(r"官网"), "website"),
    (re.compile(r"小程序"), "mini_program"),
    (re.compile(r"内测群|微信群|飞书群|discord|telegram", re.IGNORECASE), "community_channel"),
]


def log(message: str) -> None:
    print(message, flush=True)


def run_cmd(cmd: list[str], timeout: int | None = None) -> str:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{' '.join(cmd)} timed out after {timeout}s") from exc
    if proc.returncode != 0:
        err = proc.stderr.strip() or proc.stdout.strip() or "command failed"
        raise RuntimeError(f"{' '.join(cmd)} failed: {err}")
    return proc.stdout.strip()


def run_xhs_json(*args: str) -> dict[str, Any]:
    if not XHS_BIN:
        raise RuntimeError("xhs executable not found")
    text = run_cmd([str(XHS_BIN), *args, "--json"], timeout=XHS_CMD_TIMEOUT)
    return json.loads(text)


def run_openclaw_json(prompt: str) -> Any:
    if not OPENCLAW_BIN:
        raise RuntimeError("openclaw executable not found")
    text = run_cmd([
        str(OPENCLAW_BIN),
        "agent",
        "--agent",
        "main",
        "--session-id",
        str(uuid.uuid4()),
        "--local",
        "--json",
        "--message",
        prompt,
    ], timeout=OPENCLAW_TIMEOUT)
    data = json.loads(text)
    payloads = data.get("payloads", [])
    if not payloads:
        raise RuntimeError("openclaw returned no payloads")
    body = payloads[0].get("text", "").strip()
    return json.loads(body)


def heuristic_finalize(row: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
    merged = row.copy()
    merged["final_label"] = row["rule_label"]
    merged["relevance_score"] = row["rule_score"]
    merged["category"] = ""
    base_reason = row.get("rule_reason", "")
    merged["noise_reason"] = base_reason
    merged["why_it_matters"] = ""
    merged["summary"] = ""
    merged["founder_signal"] = merged.get("founder_signals", "")
    merged["outreach_angle"] = ""
    if reason:
        merged["processing_note"] = reason
    return merged


def _safe_int(value: Any) -> int:
    raw = str(value or "0").replace(",", "").strip()
    try:
        return int(raw)
    except ValueError:
        return 0


def _topic_names(tag_list: list[dict[str, Any]] | None) -> list[str]:
    if not tag_list:
        return []
    return [str(tag.get("name", "") or "").strip() for tag in tag_list if str(tag.get("name", "") or "").strip()]


def _extract_external_proof(text: str) -> list[str]:
    hits: list[str] = []
    for pattern, label in EXTERNAL_PROOF_PATTERNS:
        if pattern.search(text):
            hits.append(label)
    if re.search(r"https?://|www\.", text, re.IGNORECASE):
        hits.append("url")
    return list(dict.fromkeys(hits))


def _summarize_comments(comments: list[dict[str, Any]], author_user_id: str) -> dict[str, Any]:
    snippets: list[str] = []
    feedback_terms = [
        "什么时候", "可以", "需求", "建议", "支持", "收费", "会员", "体验", "bug",
        "问题", "适合", "内测", "用户", "场景", "功能",
    ]
    feedback_count = 0
    author_reply_count = 0

    for comment in comments[:8]:
        content = str(comment.get("content", "") or "").strip()
        if content:
            snippets.append(content[:80])
        lower = content.lower()
        if any(term in lower for term in feedback_terms):
            feedback_count += 1
        for sub in comment.get("sub_comments", []) or []:
            sub_user_id = str(sub.get("user_info", {}).get("user_id", "") or "")
            show_tags = sub.get("show_tags", []) or []
            if sub_user_id == author_user_id or "is_author" in show_tags:
                author_reply_count += 1
                sub_content = str(sub.get("content", "") or "").strip()
                if sub_content:
                    snippets.append(f"作者回复: {sub_content[:80]}")

    return {
        "comment_preview": " | ".join(dict.fromkeys(snippets[:4])),
        "feedback_count": feedback_count,
        "author_reply_count": author_reply_count,
        "has_author_reply": author_reply_count > 0,
    }


def enrich_note_evidence(row: dict[str, Any]) -> dict[str, Any]:
    merged = row.copy()
    note_id = str(row.get("note_id", "") or "")
    if not note_id:
        return merged

    try:
        detail = run_xhs_json("read", note_id)
        item = (detail.get("items") or [{}])[0]
        note = item.get("note_card", {})
        detail_desc = str(note.get("desc", "") or "").strip()
        if detail_desc:
            merged["desc"] = detail_desc
            merged["detail_desc"] = detail_desc
        tags = _topic_names(note.get("tag_list"))
        merged["topic_tags"] = tags
        merged["topic_tag_text"] = " / ".join(tags)
        merged["detail_ip_location"] = str(note.get("ip_location", "") or "").strip()
        merged["detail_time"] = str(note.get("time", "") or "")
        merged["external_proof"] = _extract_external_proof(f"{detail_desc}\n{merged['topic_tag_text']}")
    except Exception as exc:
        merged["detail_error"] = str(exc)

    if _safe_int(row.get("comment_count")) <= 0:
        return merged

    try:
        comments_payload = run_xhs_json("comments", note_id)
        comments = comments_payload.get("comments", []) or []
        merged.update(_summarize_comments(comments, str(row.get("user_id", "") or "")))
        merged["observed_comment_count"] = len(comments)
    except Exception as exc:
        merged["comments_error"] = str(exc)

    return merged


def xhs_url(note_id: str, xsec_token: str) -> str:
    if note_id and xsec_token:
        return (
            f"https://www.xiaohongshu.com/explore/{note_id}"
            f"?xsec_token={quote(xsec_token, safe='')}&xsec_source=pc_search"
        )
    if note_id:
        return f"https://www.xiaohongshu.com/explore/{note_id}"
    return ""


def extract_publish_time(note: dict[str, Any]) -> str:
    for item in note.get("corner_tag_info", []) or []:
        if item.get("type") == "publish_time" and item.get("text"):
            return str(item["text"])
    return ""


def recency_score(text: str) -> int:
    if not text:
        return 30
    if "分钟前" in text:
        return 100
    if "小时前" in text:
        return 92
    if "刚刚" in text:
        return 100
    if "昨天" in text:
        return 75
    if "前天" in text:
        return 62
    if "天前" in text:
        try:
            days = int(text.replace("天前", "").strip())
        except ValueError:
            days = 7
        return max(20, 70 - days * 8)
    return 40


def flatten_note(item: dict[str, Any], keyword: str, page: int) -> dict[str, Any]:
    note = item.get("note_card", item)
    user = note.get("user", {})
    interact = note.get("interact_info", {})
    note_id = item.get("id") or note.get("note_id", "")
    xsec_token = note.get("xsec_token", item.get("xsec_token", ""))
    title = note.get("title", note.get("display_title", "")) or ""
    desc = note.get("desc", "") or ""
    return {
        "keyword": keyword,
        "page": page,
        "note_id": note_id,
        "xsec_token": xsec_token,
        "url": xhs_url(note_id, xsec_token),
        "title": title.strip(),
        "desc": desc.strip(),
        "publish_time": extract_publish_time(note),
        "author": user.get("nickname", user.get("nick_name", "")),
        "user_id": user.get("user_id", ""),
        "note_type": note.get("type", ""),
        "liked_count": interact.get("liked_count", ""),
        "comment_count": interact.get("comment_count", ""),
        "collected_count": interact.get("collected_count", ""),
    }


def heuristic_enrich(row: dict[str, Any]) -> dict[str, Any]:
    topic_tag_text = " ".join(row.get("topic_tags", []) or [])
    comment_preview = str(row.get("comment_preview", "") or "")
    external_proof = " ".join(row.get("external_proof", []) or [])
    text = f"{row['keyword']} {row['title']} {row['desc']} {topic_tag_text} {comment_preview} {external_proof}".lower()
    noise_terms = [
        "维c", "维他命", "泡腾", "泡腾片", "vc美白", "护肤", "精华", "面膜", "口红", "唇釉",
        "减肥", "穿搭", "妆", "美妆", "美甲", "发型", "香水", "餐厅", "探店",
    ]
    strong_terms = [
        "ai", "模型", "融资", "创业", "投资", "vc", "风投", "基金", "创业者", "产品",
        "agent", "manus", "cursor", "claude", "openai", "anthropic", "sora",
    ]
    founder_terms = [
        "招合伙人", "找合伙人", "联创", "寻联创", "独立开发", "独立开发者", "上线", "内测", "公测", "用户增长", "留存", "dau", "mau",
        "商业模式", "mvp", "runway", "月收入", "营收", "从0到1", "复盘", "天使轮", "种子轮",
        "招人", "团队", "cto", "创始人", "创业中", "做产品", "项目", "产品验证",
    ]
    promo_terms = [
        "训练营", "陪跑", "闭门会", "私董会", "茶空间", "社群", "圈子", "加v", "加我", "主页加",
        "报名", "咨询", "预约", "课程", "买课", "学员", "直播间", "体验营", "代理", "招商",
        "搞钱", "副业", "变现课", "变现", "引流", "收徒", "免费领", "干货", "资料", "矩阵", "流量", "带货", "ip", "个人ip", "财税人", "疗愈师", "美业", "回收",
    ]
    noise_hits = [term for term in noise_terms if term in text]
    strong_hits = [term for term in strong_terms if term in text]
    founder_hits = [term for term in founder_terms if term in text]
    promo_hits = [term for term in promo_terms if term in text]
    founder_bias_hits = [term for term in FOUNDER_BIAS_TERMS if term in text]
    problem_bias_hits = [term for term in PROBLEM_BIAS_TERMS if term in text]
    investor_solicit_hits = [term for term in INVESTOR_SOLICIT_TERMS if term in text]
    promo_filter_hits = [term for term in PROMO_FILTER_TERMS if term in text]

    rule_label = "candidate"
    rule_score = 55
    rule_reason = ""
    founder_signal_score = min(len(founder_hits) * 12, 40)
    founder_stage = ""
    freshness = recency_score(row.get("publish_time", ""))
    freshness_bonus = max(0, (freshness - 50) // 5)
    promo_penalty = min(len(promo_hits) * 20, 60)
    author_reply_bonus = min(_safe_int(row.get("author_reply_count")) * 6, 18)
    user_feedback_bonus = min(_safe_int(row.get("feedback_count")) * 4, 16)
    external_proof_bonus = min(len(row.get("external_proof", []) or []) * 5, 15)
    founder_bias_bonus = min(len(founder_bias_hits) * 8, 24)
    problem_bias_bonus = min(len(problem_bias_hits) * 6, 18)
    investor_penalty = min(len(investor_solicit_hits) * 12, 36)
    promo_filter_penalty = min(len(promo_filter_hits) * 18, 54)

    if row["keyword"].lower() == "vc" and noise_hits:
        rule_label = "noise"
        rule_score = 8
        rule_reason = f"VC likely matched cosmetic/vitamin context: {', '.join(noise_hits[:3])}"
    elif (promo_hits or promo_filter_hits) and not founder_hits:
        rule_label = "noise"
        rule_score = max(0, 15 - promo_penalty - promo_filter_penalty)
        rule_reason = f"Likely promotional/community-selling content: {', '.join((promo_hits + promo_filter_hits)[:4])}"
    elif founder_hits:
        score = 68 + founder_signal_score + freshness_bonus - promo_penalty // 2
        score += founder_bias_bonus + problem_bias_bonus + author_reply_bonus + user_feedback_bonus + external_proof_bonus
        score -= investor_penalty
        rule_label = "relevant" if score >= 72 else "candidate"
        rule_score = min(max(20, score), 96)
        rule_reason = f"Founder/operator signals: {', '.join((founder_hits + founder_bias_hits + problem_bias_hits)[:5])}"
    elif strong_hits:
        score = 62 + freshness_bonus - promo_penalty + author_reply_bonus + user_feedback_bonus + external_proof_bonus
        score += problem_bias_bonus
        score -= investor_penalty + promo_filter_penalty
        rule_label = "relevant" if score >= 74 else "candidate"
        rule_score = max(20, min(score, 90))
        rule_reason = f"Contains startup/problem signals: {', '.join((strong_hits + problem_bias_hits)[:5])}"
    elif noise_hits:
        rule_label = "noise"
        rule_score = 18
        rule_reason = f"Likely lifestyle/beauty noise: {', '.join(noise_hits[:3])}"
    elif problem_bias_hits or author_reply_bonus or user_feedback_bonus or external_proof_bonus:
        score = 56 + freshness_bonus + problem_bias_bonus + author_reply_bonus + user_feedback_bonus + external_proof_bonus
        score -= investor_penalty + promo_filter_penalty
        rule_label = "candidate" if score < 72 else "relevant"
        rule_score = max(25, min(score, 88))
        rule_reason = f"Problem-first builder clues: {', '.join((problem_bias_hits + founder_bias_hits)[:4])}"

    if any(term in text for term in ["天使轮", "种子轮", "融资"]):
        founder_stage = "fundraising"
    elif any(term in text for term in ["上线", "内测", "公测", "mvp", "产品验证"]):
        founder_stage = "shipping"
    elif any(term in text for term in ["月收入", "营收", "留存", "增长", "用户增长"]):
        founder_stage = "traction"
    elif founder_hits:
        founder_stage = "building"

    row["rule_label"] = rule_label
    row["rule_score"] = rule_score
    row["rule_reason"] = rule_reason
    row["founder_signals"] = ", ".join(founder_hits[:6])
    row["founder_signal_score"] = founder_signal_score
    row["founder_stage"] = founder_stage
    row["promo_signals"] = ", ".join(promo_hits[:6])
    row["promo_penalty"] = promo_penalty
    row["freshness_score"] = freshness
    return row


def normalize_author_post(note: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": (note.get("display_title") or "").strip(),
        "note_id": note.get("note_id", ""),
        "xsec_token": note.get("xsec_token", ""),
        "liked_count": int(str(note.get("interact_info", {}).get("liked_count", "0") or "0") or 0),
    }


def deep_dive_author(user_id: str, author: str) -> dict[str, Any]:
    try:
        posts_data = json.loads(run_cmd([str(XHS_BIN), "user-posts", user_id, "--json"], timeout=PROFILE_CMD_TIMEOUT))
        profile = json.loads(run_cmd([str(XHS_BIN), "user", user_id, "--json"], timeout=PROFILE_CMD_TIMEOUT))
    except Exception as exc:
        return {
            "author": author,
            "user_id": user_id,
            "bio": "",
            "ip_location": "",
            "fans": "",
            "recent_post_count": 0,
            "founderish_post_count": 0,
            "lifestyle_post_count": 0,
            "founder_consistency_score": 0,
            "top_founder_titles": [],
            "error": str(exc),
        }
    notes = [normalize_author_post(n) for n in posts_data.get("notes", [])]
    founderish = 0
    lifestyle = 0
    top_founder_titles: list[str] = []
    founder_terms = [
        "创业", "合伙人", "招人", "上线", "产品", "公司", "项目", "ai", "agent", "mvp",
        "融资", "种子轮", "天使轮", "增长", "营收", "独立开发", "出海",
    ]
    lifestyle_terms = [
        "ootd", "fitcheck", "旅行", "海边", "美食", "照片", "穿搭", "日常", "vlog",
    ]

    for note in notes:
        text = note["title"].lower()
        founder_hit = any(term in text for term in founder_terms)
        lifestyle_hit = any(term in text for term in lifestyle_terms)
        if founder_hit:
            founderish += 1
            if note["title"]:
                top_founder_titles.append(note["title"])
        elif lifestyle_hit:
            lifestyle += 1

    consistency = 0
    if notes:
        consistency = round(founderish / len(notes) * 100)

    profile_basic = profile.get("basic_info", {})
    bio = str(profile_basic.get("desc", "") or "")
    bio_text = bio.lower()
    founder_bias = sum(1 for term in FOUNDER_BIAS_TERMS if term in bio_text)
    promo_bias = sum(1 for term in PROMO_FILTER_TERMS if term in bio_text)
    return {
        "author": author,
        "user_id": user_id,
        "bio": bio,
        "ip_location": profile_basic.get("ip_location", ""),
        "fans": next((i.get("count", "") for i in profile.get("interactions", []) if i.get("type") == "fans"), ""),
        "recent_post_count": len(notes),
        "founderish_post_count": founderish,
        "lifestyle_post_count": lifestyle,
        "founder_consistency_score": consistency,
        "top_founder_titles": top_founder_titles[:5],
        "bio_founder_bias": founder_bias,
        "bio_promo_bias": promo_bias,
    }


def attach_author_signals(rows: list[dict[str, Any]], author_reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_user = {str(report.get("user_id", "") or ""): report for report in author_reports if report.get("user_id")}
    enriched: list[dict[str, Any]] = []
    for row in rows:
        merged = row.copy()
        report = by_user.get(str(row.get("user_id", "") or ""))
        if report:
            merged["author_bio"] = report.get("bio", "")
            merged["author_ip_location"] = report.get("ip_location", "")
            merged["author_fans"] = report.get("fans", "")
            merged["author_recent_post_count"] = report.get("recent_post_count", 0)
            merged["author_founderish_post_count"] = report.get("founderish_post_count", 0)
            merged["author_founder_consistency_score"] = report.get("founder_consistency_score", 0)
            merged["author_top_titles"] = report.get("top_founder_titles", [])
            score = _safe_int(merged.get("relevance_score", merged.get("rule_score")))
            score += min(int(report.get("founder_consistency_score", 0)) // 15, 6)
            score += min(int(report.get("bio_founder_bias", 0)) * 2, 4)
            score -= min(int(report.get("bio_promo_bias", 0)) * 4, 12)
            merged["relevance_score"] = max(0, min(score, 100))
        enriched.append(merged)
    return enriched


def enrich_with_openclaw(rows: list[dict[str, Any]], goal: str) -> list[dict[str, Any]]:
    compact = []
    for row in rows:
        compact.append({
            "note_id": row["note_id"],
            "keyword": row["keyword"],
            "title": row["title"],
            "desc": row["desc"][:280],
            "topic_tags": row.get("topic_tags", []),
            "comment_preview": row.get("comment_preview", ""),
            "author_reply_count": row.get("author_reply_count", 0),
            "external_proof": row.get("external_proof", []),
            "author": row["author"],
            "liked_count": row["liked_count"],
            "rule_label": row["rule_label"],
            "rule_score": row["rule_score"],
            "founder_signals": row["founder_signals"],
            "founder_stage": row["founder_stage"],
            "promo_signals": row["promo_signals"],
            "freshness_score": row["freshness_score"],
            "publish_time": row["publish_time"],
            "url": row["url"],
        })

    prompt = (
        "You are ranking Xiaohongshu results for an investor founder-discovery workflow.\n"
        f"Research goal: {goal}\n"
        "Return strict JSON only in this shape:\n"
        "{\"items\":[{\"note_id\":\"...\",\"final_label\":\"relevant|maybe|noise\","
        "\"relevance_score\":0-100,\"category\":\"...\",\"noise_reason\":\"...\","
        "\"why_it_matters\":\"...\",\"summary\":\"...\",\"founder_signal\":\"...\","
        "\"outreach_angle\":\"...\"}]}\n"
        "Rules:\n"
        "- The primary task is to find founders/builders solving real user problems, not investors, startup commentators, or AI content farmers.\n"
        "- Strongly prefer newer signals; recency matters.\n"
        "- Penalize ambiguous keyword noise, especially VC that means vitamin/cosmetics.\n"
        "- Prefer founder/operator evidence over generic AI content.\n"
        "- Strong founder evidence includes: specific problem statement, building in public, launch, MVP, recruiting, traction, revenue, fundraising, product iteration, real work context.\n"
        "- Prefer posts where comments show real user demand, feature questions, or creator replies.\n"
        "- Prefer products framed around a concrete problem, not just an industry buzzword.\n"
        "- Downrank investors sourcing deals, generic startup advice, trend commentary, and 'we invest in' posts unless they contain concrete founder/project evidence.\n"
        "- HEAVILY penalize soft-sell, community bait, training camp, IP coaching, traffic harvesting, '搞钱', courses, paid communities, and generalized knowledge sharing/content farm habits.\n"
        "- Prefer AI startup, founder, product, agent, model only when tied to a concrete user problem or product iteration.\n"
        "- summary must be one compact Chinese sentence.\n"
        "- why_it_matters must be one compact Chinese sentence focused on investor/research value.\n"
        "- outreach_angle must be one compact Chinese sentence explaining how an investor could start the conversation.\n"
        f"Input items:\n{json.dumps(compact, ensure_ascii=False)}"
    )
    try:
        data = run_openclaw_json(prompt)
    except Exception as exc:
        error_text = str(exc).replace("\n", " ").strip()
        if "timed out after" in error_text:
            short_error = "openclaw timeout"
        elif "session file locked" in error_text:
            short_error = "openclaw session locked"
        else:
            short_error = error_text[:180]
        log(f"[warn] OpenClaw fallback: {short_error}")
        return [heuristic_finalize(row, "OpenClaw fallback; heuristic labels applied") for row in rows]
    items = data.get("items", [])
    by_id = {item.get("note_id"): item for item in items if item.get("note_id")}
    enriched = []
    for row in rows:
        extra = by_id.get(row["note_id"], {})
        merged = row.copy()
        merged["final_label"] = extra.get("final_label", row["rule_label"])
        merged["relevance_score"] = extra.get("relevance_score", row["rule_score"])
        merged["category"] = extra.get("category", "")
        merged["noise_reason"] = extra.get("noise_reason", row["rule_reason"])
        merged["why_it_matters"] = extra.get("why_it_matters", "")
        merged["summary"] = extra.get("summary", "")
        merged["founder_signal"] = extra.get("founder_signal", merged.get("founder_signals", ""))
        merged["outreach_angle"] = extra.get("outreach_angle", "")
        enriched.append(merged)
    return enriched


def export_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fieldnames: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for key in row.keys():
            if key in seen:
                continue
            seen.add(key)
            fieldnames.append(key)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def build_markdown(rows: list[dict[str, Any]], goal: str, keywords: list[str]) -> str:
    relevant = [r for r in rows if r.get("final_label") == "relevant"]
    maybe = [r for r in rows if r.get("final_label") == "maybe"]
    noise = [r for r in rows if r.get("final_label") == "noise"]
    relevant.sort(key=lambda r: int(r.get("relevance_score", 0)), reverse=True)
    maybe.sort(key=lambda r: int(r.get("relevance_score", 0)), reverse=True)
    noise.sort(key=lambda r: int(r.get("relevance_score", 0)))
    author_map: dict[str, dict[str, Any]] = {}
    for row in rows:
        author = row.get("author", "")
        if not author:
            continue
        entry = author_map.setdefault(author, {
            "author": author,
            "user_id": row.get("user_id", ""),
            "best_score": 0,
            "count": 0,
            "best_title": "",
            "best_url": "",
            "stages": set(),
            "signals": set(),
        })
        entry["count"] += 1
        if int(row.get("relevance_score", 0)) > entry["best_score"]:
            entry["best_score"] = int(row.get("relevance_score", 0))
            entry["best_title"] = row.get("title", "")
            entry["best_url"] = row.get("url", "")
        if row.get("founder_stage"):
            entry["stages"].add(row["founder_stage"])
        if row.get("founder_signal"):
            entry["signals"].add(row["founder_signal"])
    author_rank = sorted(author_map.values(), key=lambda x: (x["best_score"], x["count"]), reverse=True)

    lines = []
    lines.append("# XHS Research Brief")
    lines.append("")
    lines.append(f"- Goal: {goal}")
    lines.append(f"- Keywords: {', '.join(keywords)}")
    lines.append(f"- Total results: {len(rows)}")
    lines.append(f"- Relevant: {len(relevant)} | Maybe: {len(maybe)} | Noise: {len(noise)}")
    lines.append("")
    lines.append("## Founder Watchlist")
    lines.append("")
    if not author_rank:
        lines.append("None.")
    else:
        for author in author_rank[:12]:
            lines.append(f"### {author['author']}")
            lines.append(f"- Best score: {author['best_score']}")
            lines.append(f"- Notes seen: {author['count']}")
            if author["best_title"]:
                lines.append(f"- Best note: {author['best_title']}")
            if author["best_url"]:
                lines.append(f"- Link: {author['best_url']}")
            stages = ", ".join(sorted(author["stages"]))
            if stages:
                lines.append(f"- Stages: {stages}")
            signals = " | ".join(sorted(author["signals"]))[:240]
            if signals:
                lines.append(f"- Signals: {signals}")
            lines.append("")

    def add_section(title: str, items: list[dict[str, Any]], limit: int) -> None:
        lines.append(f"## {title}")
        lines.append("")
        if not items:
            lines.append("None.")
            lines.append("")
            return
        for row in items[:limit]:
            lines.append(f"### {row['title'] or '(无标题)'}")
            lines.append(f"- Score: {row.get('relevance_score', row.get('rule_score', ''))}")
            lines.append(f"- Keyword: {row['keyword']}")
            lines.append(f"- Author: {row['author']}")
            lines.append(f"- Category: {row.get('category', '')}")
            lines.append(f"- Link: {row['url']}")
            if row.get("summary"):
                lines.append(f"- Summary: {row['summary']}")
            if row.get("why_it_matters"):
                lines.append(f"- Why it matters: {row['why_it_matters']}")
            if row.get("founder_signal"):
                lines.append(f"- Founder signal: {row['founder_signal']}")
            if row.get("outreach_angle"):
                lines.append(f"- Outreach angle: {row['outreach_angle']}")
            if row.get("publish_time"):
                lines.append(f"- Publish time: {row['publish_time']}")
            if row.get("noise_reason"):
                lines.append(f"- Noise reason: {row['noise_reason']}")
            lines.append("")

    add_section("High Relevance", relevant, 15)
    add_section("Maybe Worth Reviewing", maybe, 10)
    add_section("Noise Samples", noise, 10)
    return "\n".join(lines)


def build_deepdive_markdown(author_reports: list[dict[str, Any]]) -> str:
    lines = ["# Founder Deep Dive", ""]
    if not author_reports:
        lines.append("None.")
        return "\n".join(lines)
    for report in author_reports:
        lines.append(f"## {report['author']}")
        lines.append(f"- User ID: {report['user_id']}")
        if report.get("ip_location"):
            lines.append(f"- IP location: {report['ip_location']}")
        if report.get("fans"):
            lines.append(f"- Fans: {report['fans']}")
        lines.append(f"- Recent posts checked: {report['recent_post_count']}")
        lines.append(f"- Founder-like posts: {report['founderish_post_count']}")
        lines.append(f"- Lifestyle posts: {report['lifestyle_post_count']}")
        lines.append(f"- Founder consistency score: {report['founder_consistency_score']}")
        if report.get("bio"):
            lines.append(f"- Bio: {report['bio']}")
        if report.get("top_founder_titles"):
            lines.append("- Strongest founder-like titles:")
            for title in report["top_founder_titles"]:
                lines.append(f"  - {title}")
        lines.append("")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Enrich Xiaohongshu search results with OpenClaw")
    parser.add_argument("--keywords", nargs="+", default=DEFAULT_KEYWORDS)
    parser.add_argument(
        "--mode",
        choices=["general", "founder"],
        default="founder",
        help="Preset query/goal mode",
    )
    parser.add_argument("--pages", type=int, default=2)
    parser.add_argument("--goal", default=DEFAULT_GOAL)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--max-results", type=int, default=0, help="Cap total deduplicated notes before enrichment")
    parser.add_argument("--outdir", default=str(Path.home() / "xhs_exports"))
    parser.add_argument("--no-openclaw", action="store_true", help="Skip OpenClaw reranking and use heuristic labels only")
    parser.add_argument("--deep-dive-authors", type=int, default=0, help="Deep-dive top N authors via user-posts/user")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not XHS_BIN or not XHS_BIN.exists():
        print(f"xhs executable not found at {XHS_BIN}", file=sys.stderr)
        return 1

    if args.mode == "founder" and args.keywords == DEFAULT_KEYWORDS:
        args.keywords = FOUNDER_DISCOVERY_KEYWORDS
    if args.mode == "founder" and args.goal == DEFAULT_GOAL:
        args.goal = FOUNDER_GOAL

    raw_rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for keyword in args.keywords:
        log(f"[search] keyword={keyword}")
        for page in range(1, args.pages + 1):
            data = run_xhs_json("search", keyword, "--page", str(page), "--sort", "latest")
            page_items = data.get("items", [])
            if not isinstance(page_items, list):
                page_items = []
            before_count = len(raw_rows)
            usable_count = 0
            for item in page_items:
                note = item.get("note_card", item)
                if not isinstance(note, dict):
                    continue
                usable_count += 1
                row = heuristic_enrich(flatten_note(item, keyword, page))
                if not row["note_id"] or row["note_id"] in seen:
                    continue
                seen.add(row["note_id"])
                raw_rows.append(row)
                if args.max_results and len(raw_rows) >= args.max_results:
                    break
            if args.max_results and len(raw_rows) >= args.max_results:
                break
            log(
                f"[search] keyword={keyword} page={page} "
                f"raw_items={len(page_items)} usable_items={usable_count} "
                f"added={len(raw_rows) - before_count} total={len(raw_rows)}"
            )
        if args.max_results and len(raw_rows) >= args.max_results:
            break

    log(f"[search] deduped_total={len(raw_rows)}")

    detail_candidates = sorted(
        raw_rows,
        key=lambda row: (
            _safe_int(row.get("rule_score")),
            _safe_int(row.get("comment_count")),
            _safe_int(row.get("liked_count")),
        ),
        reverse=True,
    )[: min(NOTE_DETAIL_LIMIT, len(raw_rows))]
    detail_map: dict[str, dict[str, Any]] = {}
    for idx, row in enumerate(detail_candidates, 1):
        log(f"[detail] note={idx}/{len(detail_candidates)} note_id={row['note_id']}")
        detail_map[row["note_id"]] = enrich_note_evidence(row)
    raw_rows = [detail_map.get(row["note_id"], row) for row in raw_rows]

    enriched_rows: list[dict[str, Any]] = []
    if args.no_openclaw:
        log("[enrich] OpenClaw disabled; using heuristic labels only")
        for row in raw_rows:
            enriched_rows.append(heuristic_finalize(row))
    else:
        for i in range(0, len(raw_rows), args.batch_size):
            batch = raw_rows[i:i + args.batch_size]
            batch_end = min(i + args.batch_size, len(raw_rows))
            log(f"[enrich] batch={i // args.batch_size + 1} rows={i + 1}-{batch_end}/{len(raw_rows)}")
            enriched_rows.extend(enrich_with_openclaw(batch, args.goal))
            log(f"[enrich] completed rows={batch_end}/{len(raw_rows)}")

    enriched_rows.sort(key=lambda r: int(r.get("relevance_score", 0)), reverse=True)
    log(f"[export] enriched_total={len(enriched_rows)}")

    author_scan_reports: list[dict[str, Any]] = []
    seen_scan_authors: set[str] = set()
    for row in enriched_rows:
        if row.get("final_label") == "noise" or not row.get("user_id"):
            continue
        user_id = str(row["user_id"])
        if user_id in seen_scan_authors:
            continue
        seen_scan_authors.add(user_id)
        log(f"[author-scan] author={row['author']} ({len(author_scan_reports) + 1}/{AUTHOR_SCAN_LIMIT})")
        author_scan_reports.append(deep_dive_author(user_id, row["author"]))
        if len(author_scan_reports) >= AUTHOR_SCAN_LIMIT:
            break
    if author_scan_reports:
        enriched_rows = attach_author_signals(enriched_rows, author_scan_reports)
        enriched_rows.sort(key=lambda r: int(r.get("relevance_score", 0)), reverse=True)

    outdir = Path(args.outdir).expanduser()
    outdir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = outdir / f"xhs_enriched_{stamp}.csv"
    json_path = outdir / f"xhs_enriched_{stamp}.json"
    md_path = outdir / f"xhs_brief_{stamp}.md"
    deepdive_path = outdir / f"xhs_founder_deepdive_{stamp}.md"

    export_csv(csv_path, enriched_rows)
    json_path.write_text(json.dumps(enriched_rows, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(build_markdown(enriched_rows, args.goal, args.keywords), encoding="utf-8")

    author_reports: list[dict[str, Any]] = []
    if args.deep_dive_authors:
        seen_authors: set[str] = set()
        candidates = [r for r in enriched_rows if r.get("final_label") != "noise" and r.get("user_id")]
        candidates.sort(key=lambda r: int(r.get("relevance_score", 0)), reverse=True)
        for row in candidates:
            if row["user_id"] in seen_authors:
                continue
            seen_authors.add(row["user_id"])
            log(f"[deep-dive] author={row['author']} user_id={row['user_id']} ({len(author_reports) + 1}/{args.deep_dive_authors})")
            author_reports.append(deep_dive_author(row["user_id"], row["author"]))
            if len(author_reports) >= args.deep_dive_authors:
                break
        deepdive_path.write_text(build_deepdive_markdown(author_reports), encoding="utf-8")

    print(f"Enriched {len(enriched_rows)} notes -> {csv_path}")
    print(f"JSON -> {json_path}")
    print(f"Brief -> {md_path}")
    if args.deep_dive_authors:
        print(f"Founder deep dive -> {deepdive_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
