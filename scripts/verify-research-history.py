"""Exercise history metadata and deletion without starting an AI request."""
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services/vibe-trading/agent"))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from src.api import sessions_routes
from src.session.models import Attempt, AttemptStatus, Session
from src.session.events import EventBus
from src.session.search import SessionSearchIndex
from src.session.service import SessionService
from src.session.store import SessionStore


class ResearchHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = SessionStore(Path(self.temp.name))
        self.older = Session(title="Older research", updated_at="2026-01-01T00:00:00+00:00")
        self.newer = Session(title="Newer research", updated_at="2026-02-01T00:00:00+00:00")
        for session in (self.older, self.newer):
            self.store.create_session(session)
        self.index = SessionSearchIndex(Path(self.temp.name) / 'search.sqlite')
        self.addCleanup(self.index._get_conn().close)
        for session in (self.older, self.newer):
            self.index.index_session(session.session_id, session.title)
            self.index.index_message(session.session_id, 'user', 'history verification')
        with patch('src.session.service.get_shared_index', return_value=self.index):
            service = SessionService(self.store, EventBus(), Path(self.temp.name) / 'runs')
        host = types.ModuleType("api_server")
        host.require_auth = lambda: None
        host.require_event_stream_auth = lambda: None
        host._get_session_service = lambda: service
        host._validate_path_param = lambda value, kind: None
        modules = patch.dict(sys.modules, {"api_server": host})
        modules.start()
        self.addCleanup(modules.stop)
        goals = patch.object(sessions_routes, "_get_goal_store", return_value=types.SimpleNamespace(delete_session_goals=lambda sid: None))
        goals.start()
        self.addCleanup(goals.stop)
        app = FastAPI()
        sessions_routes.register_sessions_routes(app)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_rename_persists_without_changing_research_time(self):
        response = self.client.patch(f"/sessions/{self.older.session_id}", json={"title": "  Renamed research  "})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "Renamed research")
        reloaded = SessionStore(Path(self.temp.name)).get_session(self.older.session_id)
        self.assertEqual(reloaded.title, "Renamed research")
        self.assertEqual(reloaded.updated_at, self.older.updated_at)
        match = next(item for item in self.index.search('verification') if item.session_id == self.older.session_id)
        self.assertEqual(match.title, 'Renamed research')

    def test_pin_sorted_before_limit_and_unpin_restores_recency(self):
        sid = self.older.session_id
        self.assertEqual(self.client.patch(f"/sessions/{sid}", json={"pinned": True}).status_code, 200)
        self.assertTrue(SessionStore(Path(self.temp.name)).get_session(sid).pinned)
        result = self.client.get("/sessions?limit=1").json()
        self.assertEqual(result[0]["session_id"], sid)
        self.assertTrue(result[0]["pinned"])
        self.client.patch(f"/sessions/{sid}", json={"pinned": False})
        self.assertEqual(self.client.get("/sessions?limit=1").json()[0]["session_id"], self.newer.session_id)

    def test_legacy_session_defaults_to_unpinned(self):
        data = self.older.to_dict()
        data.pop("pinned")
        self.assertFalse(Session.from_dict(data).pinned)

    def test_invalid_names_are_rejected(self):
        for title in ("", "   ", "x" * 121):
            with self.subTest(title=title):
                self.assertEqual(self.client.patch(f"/sessions/{self.older.session_id}", json={"title": title}).status_code, 422)
        self.assertEqual(self.store.get_session(self.older.session_id).title, "Older research")

    def test_delete_removes_only_selected_session(self):
        sid = self.older.session_id
        self.assertEqual(self.client.delete(f"/sessions/{sid}").status_code, 200)
        self.assertIsNone(self.store.get_session(sid))
        self.assertIsNotNone(self.store.get_session(self.newer.session_id))
        self.assertNotIn(sid, [item.session_id for item in self.index.search('verification')])
        self.assertEqual(self.client.delete(f"/sessions/{sid}").status_code, 404)

    def test_inflight_research_cannot_be_deleted(self):
        for status in (AttemptStatus.PENDING, AttemptStatus.RUNNING):
            with self.subTest(status=status):
                attempt = Attempt(session_id=self.older.session_id, status=status)
                self.store.create_attempt(attempt)
                self.older.last_attempt_id = attempt.attempt_id
                self.store.update_session(self.older)
                response = self.client.delete(f"/sessions/{self.older.session_id}")
                self.assertEqual(response.status_code, 409)
                self.assertIsNotNone(self.store.get_session(self.older.session_id))


if __name__ == "__main__":
    unittest.main(verbosity=2)
