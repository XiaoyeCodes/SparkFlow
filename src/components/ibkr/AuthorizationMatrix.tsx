import type { Snapshot } from '../../lib/ibkr/types';

export function AuthorizationMatrix({ snapshot }: { snapshot: Snapshot }) {
  const account = snapshot.connection === 'connected' ? snapshot.accountKey : '未绑定指定账户';
  return <section className="ibkr-authorization" aria-label="交易与数据授权矩阵">
    <h2>授权矩阵</h2>
    <p>只读账户查看、人工订单、自动策略与 AI 分享分别授权；一项状态不会开启另一项。</p>
    <div className="ibkr-table-scroll"><table><thead><tr><th>能力</th><th>账户</th><th>策略／范围</th><th>风险限额</th><th>有效期</th><th>状态</th></tr></thead><tbody>
      <tr><td>账户查看</td><td>{account}</td><td>持仓／余额／订单／成交只读</td><td>不适用</td><td>当前本地会话</td><td>{snapshot.connection === 'connected' ? '已连接只读' : '待登录与绑定'}</td></tr>
      <tr><td>人工订单</td><td>{account}</td><td>{snapshot.mode === 'paper' ? '美股 / ETF 整股 DAY 限价' : '品种与订单类型未确认'}</td><td>{snapshot.mode === 'paper' ? '在订单工作区设置并确认' : '单笔／总额／日亏损未提供'}</td><td>{snapshot.mode === 'paper' ? '以本次风险范围为准' : '未提供'}</td><td>{snapshot.mode === 'paper' ? '在订单工作区查看状态' : '未授权'}</td></tr>
      <tr><td>自动策略</td><td>{account}</td><td>用户策略版本与标的未确认</td><td>策略资金／敞口／日限额未提供</td><td>未提供</td><td>未授权</td></tr>
      <tr><td>账户 AI 分享</td><td>{account}</td><td>模型与字段范围未选择</td><td>调用预算未提供</td><td>未提供</td><td>关闭</td></tr>
    </tbody></table></div>
    {snapshot.mode === 'live' && <strong>LIVE 写入保持关闭；需要账户、品种、策略版本、金额与风险上限、有效期的单独明确授权。</strong>}
  </section>;
}
