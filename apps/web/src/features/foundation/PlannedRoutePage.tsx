import { Alert, Button, Result } from "antd";
import { useNavigate } from "react-router-dom";

type PlannedRoutePageProps = {
  title: string;
  phase: string;
};

export function PlannedRoutePage({ title, phase }: PlannedRoutePageProps) {
  const navigate = useNavigate();
  return (
    <main className="page" aria-labelledby="planned-title">
      <Result
        status="info"
        title={<span id="planned-title">{title}</span>}
        subTitle={`该真实业务能力将在 ${phase} 阶段按 PRD 验收场景实现。`}
        extra={
          <Button
            onClick={() => {
              void navigate("/foundation");
            }}
          >
            查看工程状态
          </Button>
        }
      />
      <Alert
        type="warning"
        showIcon
        title="此路由不是完成标志"
        description="当前仅保留冻结的信息架构入口；没有写入假数据或前端业务规则。"
      />
    </main>
  );
}
