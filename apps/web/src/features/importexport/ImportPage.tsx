import {
  InboxOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Space,
  Table,
  Tag,
  Tabs,
  Typography,
  Upload,
  type UploadProps,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api/ApiError";
import {
  downloadImportErrorsCsv,
  executeImport,
  getImportErrors,
  uploadTemplateXlsx,
  type ColumnPreview,
  type ImportError,
  type ImportJobStatus,
  type ImportPreview,
  type ColumnMapping,
  parseScheduleWorkbook,
  previewScheduleImport,
  executeScheduleImport,
  type ScheduleImportPreview,
} from "./importApi";
import { invalidateTaskViews } from "../tasks/taskActions";

const { Dragger } = Upload;

export function ImportPage() {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportJobStatus | null>(null);
  const [mappings, setMappings] = useState<Record<string, ColumnMapping>>({});

  const hasErrors = result?.status === "PARTIAL" || result?.status === "FAILED";
  const errorsJobId = result && hasErrors ? result.jobId : null;

  const errorsQuery = useQuery({
    queryKey: ["import-errors", errorsJobId],
    queryFn: () => getImportErrors(errorsJobId as string, 200, 0),
    enabled: errorsJobId !== null,
  });

  const csvDownloadMutation = useMutation({
    mutationFn: (jobId: string) => downloadImportErrorsCsv(jobId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadTemplateXlsx(file),
    onSuccess: (data) => {
      setPreview(data);
      setResult(null);
      const initialMappings: Record<string, ColumnMapping> = {};
      for (const col of data.columns) {
        if (col.nonEmptyCount === 0) continue;
        initialMappings[col.columnLabel] = {
          columnLabel: col.columnLabel,
          action: "CREATE",
          templateCode: col.columnLabel,
          templateName: col.columnLabel,
          shortName:
            col.columnLabel.length > 10
              ? col.columnLabel.slice(0, 10)
              : col.columnLabel,
          subjectCode: "OTHER",
          unitLabel: col.parsedUnit ?? undefined,
          defaultDurationMinutes: col.parsedDurationMinutes ?? undefined,
          defaultRequiresDevice: false,
        };
      }
      setMappings(initialMappings);
    },
  });

  const executeMutation = useMutation({
    mutationFn: (params: { jobId: string; mappings: ColumnMapping[] }) =>
      executeImport(params.jobId, params.mappings),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      setResult(data);
    },
  });

  const draggerProps: UploadProps = {
    name: "file",
    accept: ".xlsx,.xls",
    multiple: false,
    beforeUpload: (file) => {
      void uploadMutation.mutateAsync(file);
      return false;
    },
    showUploadList: false,
  };

  const handleExecute = () => {
    if (!preview) return;
    const activeMappings = Object.values(mappings).filter(
      (m) => m.action === "CREATE",
    );
    executeMutation.mutate({
      jobId: preview.jobId,
      mappings: activeMappings,
    });
  };

  const updateMapping = (
    columnLabel: string,
    field: keyof ColumnMapping,
    value: unknown,
  ) => {
    setMappings((prev) => ({
      ...prev,
      [columnLabel]: { ...prev[columnLabel], [field]: value },
    }));
  };

  return (
    <Card title="导入与导出">
      <Tabs
        defaultActiveKey="schedule"
        items={[
          {
            key: "schedule",
            label: "导入排期",
            children: <ScheduleImportPanel />,
          },
          {
            key: "template",
            label: "导入模板",
            children: (
              <Space
                direction="vertical"
                size="large"
                style={{ width: "100%" }}
              >
                <Dragger {...draggerProps}>
                  <p className="ant-upload-drag-icon">
                    <InboxOutlined />
                  </p>
                  <p className="ant-upload-text">
                    点击或拖拽 Excel 文件到此区域
                  </p>
                  <p className="ant-upload-hint">
                    支持 .xlsx 格式的"作业进度目录"工作表
                  </p>
                </Dragger>

                {uploadMutation.isError ? (
                  <Alert
                    type="error"
                    title="上传失败"
                    description={
                      uploadMutation.error instanceof ApiError
                        ? uploadMutation.error.message
                        : uploadMutation.error instanceof Error
                          ? uploadMutation.error.message
                          : "文件解析失败"
                    }
                    showIcon
                  />
                ) : null}

                {preview ? (
                  <Card
                    type="inner"
                    title={`预览: ${preview.fileName} (${preview.validColumns}/${preview.totalColumns} 个有效列)`}
                    extra={
                      <Button
                        type="primary"
                        loading={executeMutation.isPending}
                        onClick={handleExecute}
                        disabled={
                          Object.values(mappings).filter(
                            (m) => m.action === "CREATE",
                          ).length === 0
                        }
                      >
                        执行导入
                      </Button>
                    }
                  >
                    {preview.columns.length === 0 ? (
                      <Empty description="未识别到有效列" />
                    ) : (
                      <Table<ColumnPreview>
                        rowKey="columnLabel"
                        dataSource={preview.columns.filter(
                          (c) => c.nonEmptyCount > 0,
                        )}
                        pagination={false}
                        scroll={{ x: 800 }}
                        columns={[
                          {
                            title: "列名",
                            dataIndex: "columnLabel",
                            key: "columnLabel",
                            width: 120,
                          },
                          {
                            title: "元数据",
                            dataIndex: "metadata",
                            key: "metadata",
                            width: 150,
                          },
                          {
                            title: "解析单位",
                            dataIndex: "parsedUnit",
                            key: "parsedUnit",
                            width: 80,
                            render: (v: string | null) => v ?? "-",
                          },
                          {
                            title: "时长",
                            dataIndex: "parsedDurationMinutes",
                            key: "parsedDurationMinutes",
                            width: 80,
                            render: (v: number | null) =>
                              v != null ? `${v}分钟` : "-",
                          },
                          {
                            title: "单元数",
                            dataIndex: "nonEmptyCount",
                            key: "nonEmptyCount",
                            width: 80,
                            render: (v: number) => <Tag color="blue">{v}</Tag>,
                          },
                          {
                            title: "样例",
                            dataIndex: "sampleTitles",
                            key: "sampleTitles",
                            render: (titles: string[]) => (
                              <Space direction="vertical" size={0}>
                                {titles.map((t, i) => (
                                  <Typography.Text
                                    key={i}
                                    type="secondary"
                                    ellipsis
                                  >
                                    {t}
                                  </Typography.Text>
                                ))}
                              </Space>
                            ),
                          },
                          {
                            title: "模板编码",
                            key: "templateCode",
                            width: 120,
                            render: (_v: unknown, row: ColumnPreview) => (
                              <Input
                                value={
                                  mappings[row.columnLabel]?.templateCode ?? ""
                                }
                                onChange={(e) =>
                                  updateMapping(
                                    row.columnLabel,
                                    "templateCode",
                                    e.target.value,
                                  )
                                }
                                size="small"
                              />
                            ),
                          },
                          {
                            title: "模板名称",
                            key: "templateName",
                            width: 120,
                            render: (_v: unknown, row: ColumnPreview) => (
                              <Input
                                value={
                                  mappings[row.columnLabel]?.templateName ?? ""
                                }
                                onChange={(e) =>
                                  updateMapping(
                                    row.columnLabel,
                                    "templateName",
                                    e.target.value,
                                  )
                                }
                                size="small"
                              />
                            ),
                          },
                          {
                            title: "操作",
                            key: "action",
                            width: 100,
                            render: (_v: unknown, row: ColumnPreview) => (
                              <Button
                                size="small"
                                type={
                                  mappings[row.columnLabel]?.action === "CREATE"
                                    ? "primary"
                                    : "default"
                                }
                                onClick={() =>
                                  updateMapping(
                                    row.columnLabel,
                                    "action",
                                    mappings[row.columnLabel]?.action ===
                                      "CREATE"
                                      ? "IGNORE"
                                      : "CREATE",
                                  )
                                }
                              >
                                {mappings[row.columnLabel]?.action === "CREATE"
                                  ? "导入"
                                  : "跳过"}
                              </Button>
                            ),
                          },
                        ]}
                      />
                    )}
                  </Card>
                ) : null}

                {result ? (
                  <Card
                    type="inner"
                    title={
                      <Space align="center">
                        <Alert
                          style={{ padding: 0, background: "transparent" }}
                          type={
                            result.status === "SUCCEEDED"
                              ? "success"
                              : result.status === "FAILED"
                                ? "error"
                                : "warning"
                          }
                          icon={
                            result.status === "SUCCEEDED" ? (
                              <CheckCircleOutlined />
                            ) : (
                              <WarningOutlined />
                            )
                          }
                          showIcon
                          message={`导入${result.status === "SUCCEEDED" ? "成功" : result.status === "FAILED" ? "失败" : "部分成功"}: ${result.succeededColumns} 成功, ${result.failedColumns} 失败`}
                        />
                        {hasErrors ? (
                          <Button
                            icon={<DownloadOutlined />}
                            loading={csvDownloadMutation.isPending}
                            onClick={() =>
                              csvDownloadMutation.mutate(result.jobId)
                            }
                          >
                            下载错误明细
                          </Button>
                        ) : null}
                      </Space>
                    }
                  >
                    <Space direction="vertical" style={{ width: "100%" }}>
                      {result.errors.length > 0 ? (
                        <Space direction="vertical" size={0}>
                          {result.errors.map((err, i) => (
                            <Typography.Text key={i} type="danger">
                              {err}
                            </Typography.Text>
                          ))}
                        </Space>
                      ) : result.status === "SUCCEEDED" ? (
                        <Link to="/templates">查看模板列表</Link>
                      ) : null}

                      {hasErrors &&
                      errorsQuery.data &&
                      errorsQuery.data.errors.length > 0 ? (
                        <Table<ImportError>
                          rowKey={(row, index) =>
                            `${row.sheet ?? ""}-${row.rowNumber ?? ""}-${row.columnName ?? ""}-${index ?? 0}`
                          }
                          dataSource={errorsQuery.data.errors}
                          size="small"
                          pagination={{ pageSize: 20, showSizeChanger: false }}
                          scroll={{ x: 700 }}
                          columns={[
                            {
                              title: "Sheet",
                              dataIndex: "sheet",
                              key: "sheet",
                              width: 120,
                              render: (v: string | null) => v ?? "-",
                            },
                            {
                              title: "行号",
                              dataIndex: "rowNumber",
                              key: "rowNumber",
                              width: 80,
                              render: (v: number | null) => v ?? "-",
                            },
                            {
                              title: "列",
                              dataIndex: "columnName",
                              key: "columnName",
                              width: 120,
                              render: (v: string | null) => v ?? "-",
                            },
                            {
                              title: "错误码",
                              dataIndex: "errorCode",
                              key: "errorCode",
                              width: 120,
                              render: (v: string | null) =>
                                v ? <Tag color="red">{v}</Tag> : "-",
                            },
                            {
                              title: "信息",
                              dataIndex: "message",
                              key: "message",
                              render: (v: string | null) => v ?? "-",
                            },
                          ]}
                        />
                      ) : null}
                    </Space>
                  </Card>
                ) : null}
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}

function ScheduleImportPanel() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Awaited<
    ReturnType<typeof parseScheduleWorkbook>
  > | null>(null);
  const [plan, setPlan] = useState<ScheduleImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewMutation = useMutation({
    mutationFn: (nextRows: Awaited<ReturnType<typeof parseScheduleWorkbook>>) =>
      previewScheduleImport(nextRows),
    onSuccess: (nextPlan) => setPlan(nextPlan),
  });
  const executeMutation = useMutation({
    mutationFn: (nextPlan: ScheduleImportPreview) =>
      executeScheduleImport(nextPlan),
    onSuccess: async () => {
      await invalidateTaskViews(queryClient);
      setPlan(null);
    },
  });
  const props: UploadProps = {
    accept: ".xlsx,.xls",
    multiple: false,
    showUploadList: false,
    beforeUpload: (file) => {
      setError(null);
      setRows(null);
      setPlan(null);
      previewMutation.reset();
      executeMutation.reset();
      void parseScheduleWorkbook(file)
        .then((parsed) => {
          setRows(parsed);
          return previewMutation.mutateAsync(parsed);
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : "文件解析失败");
        });
      return false;
    },
  };
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Dragger {...props}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽排期 Excel 到此区域</p>
        <p className="ant-upload-hint">日期表头需以 YYYY-MM-DD 开头</p>
      </Dragger>
      {error ? <Alert type="error" showIcon message={error} /> : null}
      {executeMutation.isError ? (
        <Alert
          type="error"
          showIcon
          title="排期导入失败"
          description={
            executeMutation.error instanceof ApiError
              ? executeMutation.error.message
              : executeMutation.error instanceof Error
                ? executeMutation.error.message
                : "排期导入失败，请重试"
          }
          action={
            plan ? (
              <Button type="link" onClick={() => executeMutation.mutate(plan)}>
                重试
              </Button>
            ) : null
          }
        />
      ) : null}
      {rows && plan ? (
        <Card
          type="inner"
          title={`排期预览（${rows.length} 行）`}
          extra={
            <Button
              type="primary"
              loading={executeMutation.isPending}
              disabled={plan.toCreate.length === 0}
              onClick={() => executeMutation.mutate(plan)}
            >
              确认导入 {plan.toCreate.length} 条
            </Button>
          }
        >
          <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Text>
              将新增 {plan.toCreate.length} 条，跳过重复{" "}
              {plan.skippedDuplicates} 条
            </Typography.Text>
            {plan.unmatchedStudents.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message="未匹配学生"
                description={plan.unmatchedStudents
                  .map(
                    (student) =>
                      `${student.studentCode ? `${student.studentCode} / ` : ""}${student.studentName}（第 ${student.rowNumbers.join(",")} 行）`,
                  )
                  .join("；")}
              />
            ) : null}
            {plan.invalidRows.length > 0 ? (
              <Alert
                type="error"
                showIcon
                message="无效行"
                description={plan.invalidRows
                  .map((row) => `第 ${row.rowNumber} 行：${row.reason}`)
                  .join("；")}
              />
            ) : null}
            <Table
              rowKey={(row) => `${row.studentId}-${row.date}-${row.titles[0]}`}
              size="small"
              pagination={{ pageSize: 20 }}
              dataSource={plan.toCreate}
              columns={[
                { title: "姓名", dataIndex: "studentName" },
                { title: "编号", dataIndex: "studentCode" },
                { title: "日期", dataIndex: "date" },
                { title: "任务", dataIndex: ["titles", 0] },
              ]}
            />
          </Space>
        </Card>
      ) : null}
    </Space>
  );
}
