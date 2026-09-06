from datetime import datetime, timezone

import pytest

from src.ibkr_terminal.strategy import StrategyCatalog, StrategyConflict, StrategyDefinition


NOW = datetime(2026, 9, 5, tzinfo=timezone.utc)


def definition(**changes):
    value = dict(strategyId='example:scheduled-target', version='1.0.0', origin='fixture',
        name='工程示例：下一根 bar 目标仓位', universe=[12], barInterval='1D',
        entryRule='工程输入信号为 1 时，在下一根 bar 开盘买入目标股数。',
        exitRule='工程输入信号为 0 时，在下一根 bar 开盘卖出持仓。',
        parameters={'targetQuantity': '10'},
        signal={'kind': 'sma_cross', 'priceField': 'close', 'fastWindow': 1, 'slowWindow': 3,
            'entryWhen': 'FAST_ABOVE_SLOW', 'exitWhen': 'FAST_AT_OR_BELOW_SLOW'},
        positionSizing={'kind': 'fixed_quantity', 'targetQuantity': '10'},
        costs={'commissionPerOrder': '0', 'commissionPerShare': '0', 'slippageBps': '0'},
        risk={'allowShort': False, 'maxPositionQuantity': '10'},
        versionNotes='工程示例；不代表用户策略，不授予交易权限。')
    value.update(changes)
    return StrategyDefinition.model_validate(value)


def test_strategy_versions_are_hashed_immutable_and_idempotent(tmp_path):
    with StrategyCatalog(tmp_path / 'strategies.sqlite', allow_fixtures=True, clock=lambda: NOW) as catalog:
        first = catalog.save(definition())
        assert first.strategyHash == catalog.save(definition()).strategyHash
        assert first.definition.parameters == {'targetQuantity': '10'}
        changed = definition(parameters={'targetQuantity': '11'})
        with pytest.raises(StrategyConflict, match='STRATEGY_VERSION_IMMUTABLE'):
            catalog.save(changed)
        second = catalog.save(definition(version='1.0.1', parameters={'targetQuantity': '11'}))
        assert second.strategyHash != first.strategyHash
        assert [row.definition.version for row in catalog.list('example:scheduled-target')] == ['1.0.0', '1.0.1']


def test_examples_and_user_strategies_use_distinct_namespaces_and_production_rejects_fixture(tmp_path):
    with StrategyCatalog(tmp_path / 'test.sqlite', allow_fixtures=True, clock=lambda: NOW) as catalog:
        catalog.save(definition())
        user = catalog.save(definition(strategyId='user:atlas-rule', origin='user', name='待用户确认的明确规则'))
        assert user.definition.origin == 'user'
        assert [row.definition.origin for row in catalog.list()] == ['fixture', 'user']
    with StrategyCatalog(tmp_path / 'production.sqlite', clock=lambda: NOW) as production:
        with pytest.raises(StrategyConflict, match='FIXTURE_STRATEGY_DISABLED'):
            production.save(definition())


@pytest.mark.parametrize('change', [
    {'strategyId': 'user:wrong', 'origin': 'fixture'},
    {'strategyId': 'example:wrong', 'origin': 'user'},
    {'parameters': {'targetQuantity': 10}},
    {'universe': [12, 12]},
    {'barInterval': '1m'},
])
def test_strategy_contract_rejects_ambiguous_or_cross_namespace_definitions(change):
    with pytest.raises(ValueError):
        definition(**change)
