import pytest
from src.ibkr_terminal.runtime_lease import RuntimeLease


def test_only_one_service_can_own_runtime_and_recover_orders(tmp_path):
    with RuntimeLease(tmp_path):
        with pytest.raises(RuntimeError,match='already owned'):
            RuntimeLease(tmp_path)
    with RuntimeLease(tmp_path):
        pass
