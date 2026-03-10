"""
SQLite persistence layer for regime history.
"""

import sqlite3
import json
import time
import os

DB_PATH = os.environ.get("DB_PATH", "./macro_oracle.db")


def get_conn():
    return sqlite3.connect(DB_PATH)


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS regime_history (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                ts         REAL NOT NULL,
                regime     TEXT NOT NULL,
                confidence INTEGER NOT NULL,
                narrative  TEXT,
                signals    TEXT,
                raw        TEXT
            )
        """)
        conn.commit()
    print(f"[db] Initialized at {DB_PATH}")


def save_regime(result: dict):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO regime_history (ts, regime, confidence, narrative, signals, raw) VALUES (?,?,?,?,?,?)",
            (
                result.get("ts", time.time()),
                result.get("regime"),
                result.get("confidence", 0),
                result.get("narrative", ""),
                json.dumps(result.get("signals", {})),
                json.dumps(result.get("raw_changes", {})),
            )
        )
        conn.commit()


def get_regime_history(limit: int = 50) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT ts, regime, confidence, narrative, signals FROM regime_history ORDER BY ts DESC LIMIT ?",
            (limit,)
        ).fetchall()
    return [
        {
            "ts":         row[0],
            "regime":     row[1],
            "confidence": row[2],
            "narrative":  row[3],
            "signals":    json.loads(row[4]) if row[4] else {},
        }
        for row in rows
    ]
