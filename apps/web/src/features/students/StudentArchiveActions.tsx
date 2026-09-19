import { Alert, App, Button, Space, Typography } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessDate } from "../foundation/useBusinessDate";
import { invalidateTaskViews } from "../tasks/taskActions";
import {
  archiveStudent,
  getArchiveImpact,
  restoreStudent,
  type Student,
} from "./studentApi";

async function invalidateStudentViews(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["students"] }),
    queryClient.invalidateQueries({ queryKey: ["student"] }),
    queryClient.invalidateQueries({ queryKey: ["long-tasks"] }),
    queryClient.invalidateQueries({ queryKey: ["tracks"] }),
    invalidateTaskViews(queryClient),
  ]);
}

export function ArchiveStudentButton({
  student,
  onArchived,
}: {
  student: Pick<Student, "id" | "name" | "version">;
  onArchived?: () => void;
}) {
  const { modal, message } = App.useApp();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => archiveStudent(student.id, student.version),
    onSuccess: async () => {
      await invalidateStudentViews(queryClient);
      void message.success("学生已归档");
      onArchived?.();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const confirmArchive = async () => {
    try {
      const impact = await getArchiveImpact(student.id);
      const privateDefinitions = impact.definitions
        .map((item) => `“${item.name}”`)
        .join("、");
      modal.confirm({
        title: `归档 ${student.name}？`,
        content: (
          <Space direction="vertical" size={4}>
            <Typography.Text>
              将取消 {impact.pendingTaskCount} 条待办、暂停{" "}
              {impact.tracks.length} 个长期任务。
            </Typography.Text>
            {privateDefinitions ? (
              <Typography.Text>
                其中 {privateDefinitions} 仅该生使用，将一并归档。
              </Typography.Text>
            ) : null}
          </Space>
        ),
        okText: "确认归档",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: () => mutation.mutateAsync(),
      });
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "无法读取归档影响",
      );
    }
  };

  return (
    <Button
      danger
      loading={mutation.isPending}
      onClick={() => void confirmArchive()}
    >
      归档学生
    </Button>
  );
}

export function ArchivedStudentBanner({ student }: { student: Student }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const businessDate = useBusinessDate();
  const mutation = useMutation({
    mutationFn: () =>
      restoreStudent(student.id, {
        expectedVersion: student.version,
        businessDate,
      }),
    onSuccess: async (result) => {
      await invalidateStudentViews(queryClient);
      if (result.warnings.length > 0) {
        void message.warning(result.warnings.join("；"));
      } else {
        void message.success("学生已恢复，长期任务已重新接排");
      }
    },
    onError: (error: Error) => void message.error(error.message),
  });

  return (
    <Alert
      type="warning"
      showIcon
      title={`已归档${student.archivedAt ? `于 ${student.archivedAt.slice(0, 10)}` : ""}`}
      description="恢复后仅重新启用归档时暂停的长期任务；已取消的临时任务不会恢复。"
      action={
        <Button
          type="primary"
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          恢复
        </Button>
      }
    />
  );
}
