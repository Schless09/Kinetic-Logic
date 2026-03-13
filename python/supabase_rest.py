"""Tiny Supabase REST helper for worker scripts (no supabase-py dependency)."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

import httpx


class SupabaseRest:
    def __init__(self, url: str, api_key: str):
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.client = httpx.Client(timeout=30.0)

    def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        h = {
            "apikey": self.api_key,
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if extra:
            h.update(extra)
        return h

    def get(self, table: str, params: Dict[str, str]) -> Any:
        r = self.client.get(
            f"{self.url}/rest/v1/{table}",
            params=params,
            headers=self._headers(),
        )
        r.raise_for_status()
        return r.json()

    def patch(self, table: str, match: Dict[str, str], body: Dict[str, Any]) -> Any:
        params = {k: f"eq.{v}" for k, v in match.items()}
        r = self.client.patch(
            f"{self.url}/rest/v1/{table}",
            params=params,
            json=body,
            headers=self._headers({"Prefer": "return=representation"}),
        )
        r.raise_for_status()
        return r.json()

    def post(self, table: str, rows: list[Dict[str, Any]]) -> Any:
        r = self.client.post(
            f"{self.url}/rest/v1/{table}",
            json=rows,
            headers=self._headers({"Prefer": "return=representation"}),
        )
        r.raise_for_status()
        return r.json()

