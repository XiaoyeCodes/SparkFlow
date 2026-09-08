import test from 'node:test';
import assert from 'node:assert/strict';
import { holdingIndustryDetails, holdingIndustryLabel, industryLabel, instrumentTypeLabel } from '../../src/lib/ibkr/industryLabels.ts';

test('verified industries and sectors are localized for display', () => {
  assert.equal(industryLabel('Consumer Electronics'), '消费电子');
  assert.equal(industryLabel('Software—Infrastructure'), '基础软件');
  assert.equal(industryLabel('Communication Services'), '通信服务');
  assert.equal(industryLabel('Consumer Non-Durables'), '必需消费品');
  assert.equal(industryLabel('Aerospace & Defense'), 'Aerospace & Defense');
  assert.equal(instrumentTypeLabel('EQUITY'), '股票');
});

test('holding labels prefer detailed industry and keep ETF classification explicit', () => {
  assert.equal(holdingIndustryLabel({ instrumentType: 'STK', sector: 'Technology', industry: 'Semiconductors' }), '半导体');
  assert.equal(holdingIndustryDetails({ instrumentType: 'STK', sector: 'Technology', industry: 'Semiconductors' }), '科技 · 半导体');
  assert.equal(holdingIndustryLabel({ instrumentType: 'ETF', sector: 'Miscellaneous' }), 'ETF');
  assert.equal(holdingIndustryDetails({ instrumentType: 'ETF' }), 'ETF（不穿透）');
  assert.equal(holdingIndustryLabel({ instrumentType: 'STK' }), '行业核实中');
});
