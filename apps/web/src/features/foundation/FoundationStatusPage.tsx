import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Alert, Card, Col, Row, Space, Tag, Typography } from "antd";
import { ApiContextStatus } from "./ApiContextStatus";

const completed = [
  "单仓目录与 pnpm workspace",
  "React/Vite/TypeScript strict",
  "顶部导航与明确路由",
  "Tauri 2 薄壳",
  "API /context 契约与真实请求状态",
  "根级错误边界与可重试错误提示",
];
const pending = [
  "本地认证、refresh session 与安全初始化",
  "PostgreSQL/Flyway 基线",
  "完整 RBAC、租户隔离与审计",
  "完整 CI/SBOM 门禁",
];

export function FoundationStatusPage() {
  return (
    <main className="page" aria-labelledby="foundation-title">
      <section className="hero-panel">
        <Tag color="blue">WBS Phase 0</Tag>
        <Typography.Title id="foundation-title">
          Foundation 工程基线
        </Typography.Title>
        <Typography.Paragraph className="hero-copy">
          当前页面只展示可验证的工程状态。Today、学生工作台和任务模板尚未实现真实业务闭环，因此不会用静态示例冒充完成。
        </Typography.Paragraph>
      </section>

      <Alert
        showIcon
        type="info"
        title="最终完成条件"
        description="PRD AC-001~015、WBS 四个阶段退出门禁，以及轨道、执行、顺延、减负四项业务证明。"
      />

      <div className="context-status">
        <ApiContextStatus />
      </div>

      <Row gutter={[16, 16]} className="status-grid">
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <CheckCircleOutlined />
                已建立
              </Space>
            }
          >
            <ul className="status-list">
              {completed.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <ClockCircleOutlined />
                本阶段待关闭
              </Space>
            }
          >
            <ul className="status-list">
              {pending.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Card>
        </Col>
      </Row>

      <Card className="principle-card">
        <Space align="start">
          <SafetyCertificateOutlined className="principle-icon" />
          <div>
            <Typography.Title level={4}>状态真值在服务端</Typography.Title>
            <Typography.Paragraph>
              桌面壳与前端只负责交互和平台能力；轨道推进、顺延目标、权限、幂等和并发冲突由
              API 决定。
            </Typography.Paragraph>
          </div>
        </Space>
      </Card>
    </main>
  );
}
