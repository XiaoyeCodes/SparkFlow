"""Bounded per-subscriber queues; overflow is explicit, never a silent gap."""
import asyncio
from dataclasses import dataclass
from typing import Any


@dataclass(eq=False)
class Subscription:
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue
    active: bool = True

    def push(self, event: dict[str, Any]):
        def deliver():
            if not self.active:
                return
            if self.queue.full():
                while not self.queue.empty():
                    self.queue.get_nowait()
                self.queue.put_nowait({**{key: event[key] for key in ('mode', 'accountKey', 'sessionRevision', 'sequence')}, 'kind': 'resync-required', 'reason': 'subscriber-overflow'})
            else:
                self.queue.put_nowait(event)
        self.loop.call_soon_threadsafe(deliver)
