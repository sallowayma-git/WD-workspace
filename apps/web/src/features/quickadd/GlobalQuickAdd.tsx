import { CloseOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { invalidateTaskViews } from "../tasks/taskActions";
import { listStudents } from "../students/studentApi";
import { createAdHocTask } from "../today/taskApi";
import { useBusinessDate } from "../foundation/useBusinessDate";
import { ApiError } from "../../lib/api/ApiError";
import { cleanTitle, findDateToken, matchStudents } from "./quickAddParser";
import "./GlobalQuickAdd.css";

interface StudentToken {
  studentId: string;
  label: string;
}

interface DateToken {
  date: string;
  label: string;
}

/**
 * 顶栏全局快速添加（滴答清单式）：点击展开一个令牌输入框，输入过程中
 * 学生名与日期被直接"吸走"成输入框内的胶囊——学生按名册姓名/别名/编号
 * 匹配，日期支持 明天/周X/8月31日/0831/八月三十一 等。任务内容就是胶囊
 * 之后的剩余文本，回车创建；没有内容时回车删除最后一个胶囊；双击胶囊
 * 去除对应匹配。
 */
export function GlobalQuickAdd() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [studentToken, setStudentToken] = useState<StudentToken | null>(null);
  const [dateToken, setDateToken] = useState<DateToken | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const today = useBusinessDate();

  const studentsQuery = useQuery({
    queryKey: ["students", ""],
    queryFn: () => listStudents(),
    enabled: open,
    staleTime: 30_000,
  });
  const students = useMemo(
    () => studentsQuery.data?.items ?? [],
    [studentsQuery.data],
  );

  // 面板悬浮于页面之上，不参与顶栏 grid 布局——否则展开时会把导航挤错位。
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        anchorRef.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setText("");
        setStudentToken(null);
        setDateToken(null);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const reset = () => {
    setText("");
    setStudentToken(null);
    setDateToken(null);
  };

  const createMutation = useMutation({
    mutationFn: (params: {
      studentId: string;
      scheduledDate: string;
      title: string;
      studentName: string;
    }) =>
      createAdHocTask({
        studentId: params.studentId,
        scheduledDate: params.scheduledDate,
        title: params.title,
      }).then((task) => ({ task, params })),
    onSuccess: async ({ params }) => {
      void message.success(
        `已为 ${params.studentName} 在 ${params.scheduledDate} 添加「${params.title}」`,
      );
      reset();
      await invalidateTaskViews(queryClient);
      inputRef.current?.focus();
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "快速添加失败，请稍后重试",
      );
    },
  });

  // 每次输入变化都把文本里的日期与学生片段"吸"成胶囊（滴答清单式）。
  // 胶囊内容从文本中移除，输入框里只剩任务内容。
  const handleChange = (raw: string) => {
    let working = raw;
    const dateHit = findDateToken(raw, today);
    if (dateHit) {
      working = `${working.slice(0, dateHit.start)} ${working.slice(dateHit.end)}`;
      setDateToken({ date: dateHit.date, label: dateHit.label });
    }
    const top = matchStudents(working, students)[0] ?? null;
    if (top) {
      working = `${working.slice(0, top.index)} ${working.slice(top.index + top.length)}`;
      setStudentToken({ studentId: top.student.id, label: top.student.name });
    }
    setText(cleanTitle(working));
  };

  const removeLastToken = () => {
    if (dateToken) setDateToken(null);
    else if (studentToken) setStudentToken(null);
  };

  const submit = () => {
    const title = text.trim();
    if (title.length === 0) {
      // 约定：没有任务内容时回车 = 删除最后一个胶囊（用户口头需求）。
      removeLastToken();
      return;
    }
    if (!studentToken) {
      void message.warning("未匹配到学生：请先输入学生姓名（或编号）");
      return;
    }
    createMutation.mutate({
      studentId: studentToken.studentId,
      scheduledDate: dateToken?.date ?? today,
      title,
      studentName: studentToken.label,
    });
  };

  return (
    <span ref={anchorRef} className="quick-add-anchor">
      {open ? (
        <div className="quick-add-panel" role="group" aria-label="快速添加任务">
          <div className="quick-add-row">
            <div
              className="quick-add-field"
              onClick={() => inputRef.current?.focus()}
            >
              {studentToken ? (
                <Tag
                  color="blue"
                  className="quick-add-token"
                  title="双击去除该学生的匹配"
                  onDoubleClick={() => setStudentToken(null)}
                >
                  {studentToken.label}
                </Tag>
              ) : null}
              {dateToken ? (
                <Tag
                  color="purple"
                  className="quick-add-token"
                  title="双击去除该日期的匹配"
                  onDoubleClick={() => setDateToken(null)}
                >
                  {dateToken.label}
                </Tag>
              ) : null}
              <input
                ref={inputRef}
                className="quick-add-core"
                value={text}
                aria-label="快速添加任务输入"
                placeholder={
                  studentToken || dateToken
                    ? "输入任务内容，回车添加"
                    : "学生名 + 日期 + 任务，如：林同学 明天/0831 密卷08"
                }
                onChange={(event) => handleChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  } else if (event.key === "Backspace" && text.length === 0) {
                    removeLastToken();
                  } else if (event.key === "Escape") {
                    reset();
                    setOpen(false);
                  }
                }}
              />
            </div>
            <Button
              type="primary"
              loading={createMutation.isPending}
              onClick={submit}
            >
              添加
            </Button>
            <Button
              icon={<CloseOutlined />}
              aria-label="收起快速添加"
              onClick={() => {
                reset();
                setOpen(false);
              }}
            />
          </div>
        </div>
      ) : (
        <Button
          icon={<PlusOutlined />}
          aria-label="快速添加"
          onClick={() => setOpen(true)}
        >
          快速添加
        </Button>
      )}
    </span>
  );
}
