# 本地行情数据导入说明

后端会优先读取本目录下的本地数据；只有本地数据不存在时，才尝试调用 Yahoo 抓取脚本。

## 1. 回测月度数据

文件路径：

```text
data/backtest-prices.json
```

格式参考 `data/backtest-prices.template.json`。四类资产必须都有 `prices` 数组：

```json
{
  "assets": {
    "sp500": {
      "prices": [{ "date": "2000-01-01", "close": 100.0 }]
    },
    "nasdaq": {
      "prices": [{ "date": "2000-01-01", "close": 100.0 }]
    },
    "bond": {
      "prices": [{ "date": "2000-01-01", "close": 100.0 }]
    },
    "gold": {
      "prices": [{ "date": "2000-01-01", "close": 100.0 }]
    }
  }
}
```

## 2. ETF K 线数据

文件路径：

```text
data/candles/sp500-1d.json
data/candles/nasdaq-1d.json
data/candles/bond-1d.json
data/candles/gold-1d.json
```

也可以放聚合后的：

```text
data/candles/sp500-1mo.json
data/candles/nasdaq-1mo.json
data/candles/bond-1mo.json
data/candles/gold-1mo.json
```

K 线字段：

```json
{
  "candles": [
    {
      "date": "2000-01-03",
      "open": 100.0,
      "high": 101.0,
      "low": 99.0,
      "close": 100.5,
      "adjClose": 100.5,
      "volume": 123456
    }
  ]
}
```
