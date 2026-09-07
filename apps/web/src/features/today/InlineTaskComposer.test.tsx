import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineTaskComposer } from "./InlineTaskComposer";
import { createAdHocTask } from "./taskApi";
import { listTemplates, type TaskTemplate } from "../templates/templateApi";
import { MountTrackModal } from "../planning/MountTrackModal";

vi.mock("./taskApi", () => ({ createAdHocTask: vi.fn() }));
vi.mock("../tasks/useSeriesSuggestion", () => ({
  useSeriesSuggestion: () => ({ offerSeriesSuggestion: vi.fn() }),
}));
vi.mock("../templates/templateApi", () => ({
  listTemplates: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock("../planning/MountTrackModal", () => ({
  MountTrackModal: vi.fn(() => <div>课程安排表单</div>),
}));

describe("InlineTaskComposer", () => {
  afterEach(() => {
    vi.mocked(createAdHocTask).mockReset();
    vi.mocked(listTemplates).mockResolvedValue({
      items: [],
      page: 0,
      size: 0,
      total: 0,
      hasNext: false,
    });
    vi.mocked(MountTrackModal).mockClear();
  });

  it("preserves the input after failure and clears it only after a successful retry", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    vi.mocked(createAdHocTask).mockRejectedValueOnce(new Error("写入失败"));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InlineTaskComposer
          studentId="student-1"
          scheduledDate="2026-09-10"
          onCreated={onCreated}
        />
      </QueryClientProvider>,
    );
    const input = screen.getByRole("combobox");
    await user.type(input, "阅读练习{Enter}");
    await screen.findByText("写入失败");
    expect(input).toHaveValue("阅读练习");
    expect(createAdHocTask).toHaveBeenCalledTimes(1);
    vi.mocked(createAdHocTask).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof createAdHocTask>>,
    );
    await user.type(input, "{Enter}");
    await waitFor(() => expect(input).toHaveValue(""));
    expect(createAdHocTask).toHaveBeenCalledTimes(2);
    expect(createAdHocTask).toHaveBeenLastCalledWith({
      studentId: "student-1",
      scheduledDate: "2026-09-10",
      title: "阅读练习",
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("selects a course with the keyboard without also creating a task", async () => {
    const user = userEvent.setup();
    const course = {
      id: "course-1",
      name: "阅读课程",
      currentPublishedVersionId: "version-1",
    } as TaskTemplate;
    vi.mocked(listTemplates).mockResolvedValue({
      items: [course],
      page: 0,
      size: 1,
      total: 1,
      hasNext: false,
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InlineTaskComposer studentId="student-1" scheduledDate="2026-09-10" />
      </QueryClientProvider>,
    );
    await user.type(screen.getByRole("combobox"), "阅读");
    await screen.findByText("安排课程：阅读课程");
    const input = screen.getByRole("combobox");
    // rc-select reads the native legacy key code for option navigation.
    fireEvent.keyDown(input, { key: "ArrowDown", keyCode: 40, which: 40 });
    fireEvent.keyDown(input, { key: "ArrowDown", keyCode: 40, which: 40 });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13, which: 13 });
    await screen.findByText("课程安排表单");
    expect(createAdHocTask).not.toHaveBeenCalled();
    expect(vi.mocked(MountTrackModal).mock.calls.at(-1)?.[0]).toMatchObject({
      studentId: "student-1",
      initialTemplateId: "course-1",
      anchorDate: "2026-09-10",
      open: true,
    });
  });
});
