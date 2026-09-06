"""Every default terminal test is offline, including direct pytest invocations."""
import pytest
import asyncio


_api_loops = {}


def pytest_collection_modifyitems(items):
    for item in items:
        if 'api_event_loop' in item.fixturenames and item.nodeid not in _api_loops:
            # Internal asyncio IPC only, before the runtest socket ban.
            _api_loops[item.nodeid] = asyncio.new_event_loop()


def pytest_sessionfinish():
    for loop in _api_loops.values():
        if not loop.is_closed():
            loop.close()


@pytest.fixture
def api_event_loop(request):
    yield _api_loops[request.node.nodeid]


@pytest.fixture(autouse=True)
def offline_only(socket_disabled):
    yield
