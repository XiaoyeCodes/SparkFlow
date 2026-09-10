"""Authenticated graceful bridge replacement, scoped to this running instance."""
import asyncio
import hashlib
import os
from pathlib import Path
from uuid import uuid4
from fastapi.responses import JSONResponse


def code_revision(source):
    digest = hashlib.sha256()
    for file in sorted(Path(source).rglob('*.py'), key=lambda p: p.relative_to(source).as_posix()):
        digest.update(file.relative_to(source).as_posix().encode() + b'\0')
        digest.update(file.read_bytes() + b'\0')
    return digest.hexdigest()


def install_lifecycle(app, server):
    app.state.bridge_info = {'instanceId': uuid4().hex, 'pid': os.getpid(),
        'codeRevision': code_revision(Path(__file__).parent), 'gracefulRestart': True}
    app.state.bridge_stopping = False

    @app.post('/api/ibkr-terminal/bridge/shutdown')
    async def shutdown(value: dict):
        if value != {'instanceId': app.state.bridge_info['instanceId']}:
            return JSONResponse({'detail': 'BRIDGE_INSTANCE_CHANGED'}, status_code=409)
        app.state.bridge_stopping = True
        # Uvicorn waits for active requests then runs lifespan cleanup, including
        # order observers, subscriptions, database connections and runtime lease.
        asyncio.get_running_loop().call_later(.1, setattr, server, 'should_exit', True)
        return {'stopping': True}
