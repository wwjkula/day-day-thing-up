#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PyQt5 工具：按粘贴的人员姓名与选择的部门，重建 data/user_org_memberships.json。

功能
- 左侧多行文本框：粘贴姓名（每行一个，精确匹配 users.json 中的 name 字段）
- 右侧下拉框：从 org_units.json 读取部门（type=department 且 active!=false），供选择
- 点击“生成并覆盖”后：
  - 读取 users.json，查找姓名对应的用户 ID；
  - 读取 org_units.json，找到所选部门的组织 ID；
  - 生成新的 user_org_memberships.json（覆盖写入），每位用户一条主属记录：
    { userId, orgId, isPrimary: true, startDate: YYYY-MM-DD, endDate: null }
  - 自动备份原文件为 user_org_memberships.json.bak_YYYYMMDD_HHMMSS

使用方法
  pip install PyQt5
  python tools/rebuild_user_org_memberships_gui.py
"""

from __future__ import annotations

import json
import sys
import shutil
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Dict, List, Tuple

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QApplication,
    QWidget,
    QLabel,
    QTextEdit,
    QComboBox,
    QPushButton,
    QVBoxLayout,
    QHBoxLayout,
    QMessageBox,
)


ROOT = Path(__file__).resolve().parent.parent
USERS_FILE = ROOT / "data" / "users.json"
ORGS_FILE = ROOT / "data" / "org_units.json"
TARGET_FILE = ROOT / "data" / "user_org_memberships.json"


@dataclass
class UsersIndex:
    by_name: Dict[str, List[int]]

    @classmethod
    def load(cls, path: Path) -> "UsersIndex":
        raw = json.loads(path.read_text(encoding="utf-8"))
        idx: Dict[str, List[int]] = {}
        for u in raw.get("items", []):
            name = (u.get("name") or "").strip()
            if not name:
                continue
            idx.setdefault(name, []).append(int(u.get("id")))
        return cls(by_name=idx)


def load_departments(path: Path) -> List[Tuple[str, int]]:
    """返回 (display_name, id) 列表，按名称排序。包含部门与领导层等启用组织。"""
    raw = json.loads(path.read_text(encoding="utf-8"))
    allowed_types = {"department", "leadership"}
    items: List[Tuple[str, int]] = []
    for org in raw.get("items", []):
        active = org.get("active", True) is not False
        if not active:
            continue
        org_type = (org.get("type") or "").lower()
        if org_type not in allowed_types:
            continue
        name = (org.get("name") or "").strip()
        if not name:
            continue
        label = name if org_type == "department" else f"{name}（领导层）"
        items.append((label, int(org.get("id"))))
    # 去重（同名+类型组合取较小 id）
    dedup: Dict[str, int] = {}
    for label, oid in items:
        if label not in dedup or oid < dedup[label]:
            dedup[label] = oid
    return sorted(dedup.items(), key=lambda x: x[0])


def today_iso() -> str:
    return date.today().strftime("%Y-%m-%d")


class MainWindow(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("重建用户主属组织（user_org_memberships.json）")
        self.resize(720, 520)

        # UI 控件
        self.label_names = QLabel("粘贴姓名（每行一个）：")
        self.edit_names = QTextEdit()
        self.edit_names.setPlaceholderText("例如：\n张三\n李四\n王五")

        self.label_dept = QLabel("部门：")
        self.combo_dept = QComboBox()
        self.btn_reload = QPushButton("重新载入部门")
        self.btn_generate = QPushButton("生成并覆盖")
        self.btn_append = QPushButton("追加添加（不覆盖）")

        # 布局
        top = QVBoxLayout()
        top.addWidget(self.label_names)
        top.addWidget(self.edit_names, stretch=1)

        row = QHBoxLayout()
        row.addWidget(self.label_dept)
        row.addWidget(self.combo_dept, stretch=1)
        row.addWidget(self.btn_reload)
        row.addWidget(self.btn_generate)
        row.addWidget(self.btn_append)
        top.addLayout(row)

        self.setLayout(top)

        # 数据
        self.users_index = None  # type: UsersIndex | None
        self.departments: List[Tuple[str, int]] = []

        # 事件
        self.btn_reload.clicked.connect(self.load_departments_into_ui)
        self.btn_generate.clicked.connect(lambda: self.on_generate(append=False))
        self.btn_append.clicked.connect(lambda: self.on_generate(append=True))

        # 首次加载
        try:
            self.users_index = UsersIndex.load(USERS_FILE)
        except Exception as e:
            QMessageBox.critical(self, "错误", f"读取 {USERS_FILE} 失败：\n{e}")
            self.close()
            return
        self.load_departments_into_ui()

    def load_departments_into_ui(self):
        try:
            self.departments = load_departments(ORGS_FILE)
        except Exception as e:
            QMessageBox.critical(self, "错误", f"读取 {ORGS_FILE} 失败：\n{e}")
            return
        self.combo_dept.clear()
        for name, oid in self.departments:
            self.combo_dept.addItem(name, oid)
        if self.combo_dept.count() == 0:
            QMessageBox.warning(self, "提示", "未在 org_units.json 中找到可用的部门（type=department 且启用）。")

    def on_generate(self, append: bool = False):
        names_text = self.edit_names.toPlainText().strip()
        if not names_text:
            QMessageBox.information(self, "提示", "请先粘贴姓名（每行一个）")
            return
        if self.combo_dept.currentIndex() < 0:
            QMessageBox.information(self, "提示", "请先选择部门")
            return

        # 解析输入姓名
        raw_names = [n.strip() for n in names_text.splitlines()]
        names = [n for n in raw_names if n]
        if not names:
            QMessageBox.information(self, "提示", "未解析到有效姓名")
            return

        # 选中部门
        dept_name = self.combo_dept.currentText().strip()
        dept_id = int(self.combo_dept.currentData())

        # 匹配用户 ID
        assert self.users_index is not None
        missing: List[str] = []
        ambiguous: List[str] = []
        pairs: List[Tuple[str, int]] = []  # (name, userId)
        for name in names:
            ids = self.users_index.by_name.get(name, [])
            if not ids:
                missing.append(name)
                continue
            if len(ids) > 1:
                ambiguous.append(name)
                continue
            pairs.append((name, ids[0]))

        if ambiguous:
            msg_lines = ["以下姓名在 users.json 中不唯一：" + ", ".join(ambiguous), "请修正后重试（或在 users.json 中去重）。"]
            QMessageBox.warning(self, "无法生成", "\n".join(msg_lines))
            return

        # 备份旧文件
        try:
            if TARGET_FILE.exists():
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                backup = TARGET_FILE.with_name(f"{TARGET_FILE.name}.bak_{ts}")
                shutil.copy2(str(TARGET_FILE), str(backup))
        except Exception as e:
            QMessageBox.critical(self, "错误", f"备份原文件失败：\n{e}")
            return

        # 去除重复用户（按 userId 保留一次）
        unique_pairs = []
        seen_user_ids = set()
        for pair in pairs:
            uid = pair[1]
            if uid in seen_user_ids:
                continue
            seen_user_ids.add(uid)
            unique_pairs.append(pair)

        start = today_iso()
        new_records = [
            {
                "userId": int(uid),
                "orgId": int(dept_id),
                "isPrimary": True,
                "startDate": start,
                "endDate": None,
            }
            for _name, uid in unique_pairs
        ]

        total_appended = 0
        total_skipped = 0

        existing_raw = {}
        existing_items = []
        existing_meta = {}

        if append and TARGET_FILE.exists():
            try:
                existing_raw = json.loads(TARGET_FILE.read_text(encoding="utf-8"))
                existing_items = existing_raw.get("items", [])
                existing_meta = existing_raw.get("meta", {})
            except Exception as e:
                QMessageBox.critical(self, "错误", f"读取现有 {TARGET_FILE.name} 失败：\n{e}")
                return

        # 建立 userId -> 其 active 主属记录索引
        user_active_indices: Dict[int, List[Dict]] = {}
        if append:
            for item in existing_items:
                try:
                    uid = int(item.get("userId"))
                except (TypeError, ValueError):
                    continue
                if not bool(item.get("isPrimary", False)):
                    continue
                if item.get("endDate") not in (None, ""):
                    continue
                user_active_indices.setdefault(uid, []).append(item)

        # 备份旧文件
        try:
            if TARGET_FILE.exists():
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                backup = TARGET_FILE.with_name(f"{TARGET_FILE.name}.bak_{ts}")
                shutil.copy2(str(TARGET_FILE), str(backup))
        except Exception as e:
            QMessageBox.critical(self, "错误", f"备份原文件失败：\n{e}")
            return

        replacements = 0

        if append:
            def record_key(rec: Dict) -> Tuple[int, int, bool, str]:
                return (
                    int(rec.get("userId")),
                    int(rec.get("orgId")),
                    bool(rec.get("isPrimary")),
                    rec.get("startDate") or "",
                )

            existing_keys = {record_key(item) for item in existing_items}

            for record in new_records:
                uid = record["userId"]
                current_records = user_active_indices.get(uid, [])
                if current_records:
                    # 检查是否已经在同一组织
                    has_same_org = any(int(r.get("orgId")) == record["orgId"] for r in current_records)
                    if has_same_org:
                        total_skipped += 1
                        continue
                    # 替换：更新所有 active 主属记录的 orgId
                    for existing_record in current_records:
                        existing_record["orgId"] = record["orgId"]
                    replacements += len(current_records)
                    continue

                key = record_key(record)
                if key in existing_keys:
                    total_skipped += 1
                    continue
                existing_items.append(record)
                existing_keys.add(key)
                user_active_indices.setdefault(uid, []).append(record)
                total_appended += 1
            final_items = existing_items
            meta_last_id = int(existing_meta.get("lastId") or 0)
            meta_last_id = max(meta_last_id, len(final_items))
        else:
            final_items = new_records
            meta_last_id = len(final_items)
            total_appended = len(final_items)

        data = {"meta": {"lastId": meta_last_id}, "items": final_items}

        try:
            TARGET_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        except Exception as e:
            QMessageBox.critical(self, "错误", f"写入 {TARGET_FILE} 失败：\n{e}")
            return

        skipped_info = ""
        if missing:
            skipped_info = f"\n未找到并已跳过：{len(missing)} 名（{', '.join(missing)}）"

        if append:
            QMessageBox.information(
                self,
                "完成",
                (
                    f"已更新 {TARGET_FILE.name}\n"
                    f"部门：{dept_name}（ID={dept_id}）\n"
                    f"追加条数：{total_appended}\n"
                    f"跳过重复：{total_skipped}\n"
                    f"替换原归属：{replacements}\n"
                    f"合计记录：{len(final_items)}"
                    f"{skipped_info}"
                ),
            )
        else:
            QMessageBox.information(
                self,
                "完成",
                (
                    f"已写入 {TARGET_FILE.name}\n"
                    f"部门：{dept_name}（ID={dept_id}）\n"
                    f"记录数：{len(final_items)}"
                    f"{skipped_info}"
                ),
            )


def main() -> int:
    app = QApplication(sys.argv)
    w = MainWindow()
    w.show()
    return app.exec_()


if __name__ == "__main__":
    sys.exit(main())
