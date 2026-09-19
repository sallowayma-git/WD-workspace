import { App as AntApp } from "antd";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StudentStatusLabelModal } from "./StudentStatusLabelModal";
import { serializeStatusLabelColor } from "./studentStatusLabelColor";

const LABEL_A = {
  id: "10000000-0000-4000-8000-000000000001",
  label: "紧急",
  color: "#ff0000",
  sortOrder: 1,
};
const LABEL_B = {
  id: "10000000-0000-4000-8000-000000000002",
  label: "关注",
  color: "#00ff00",
  sortOrder: 2,
};

describe("StudentStatusLabelModal", () => {
  it("serializes ColorPicker values to API strings", () => {
    expect(serializeStatusLabelColor("#123456")).toBe("#123456");
    expect(serializeStatusLabelColor({ toHexString: () => "#abcdef" })).toBe(
      "#abcdef",
    );
    expect(serializeStatusLabelColor(null)).toBeNull();
  });

  it("deletes consecutive rows by their ids", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <AntApp>
        <StudentStatusLabelModal
          open
          labels={[LABEL_A, LABEL_B]}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
          onDelete={onDelete}
        />
      </AntApp>,
    );

    await user.click(screen.getByRole("button", { name: "删除状态 1" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(LABEL_A));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "删除状态 1" }),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "删除状态 1" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(LABEL_B));
  });

  it("keeps the row and shows a visible error when deletion fails", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue(new Error("删除失败"));
    render(
      <AntApp>
        <StudentStatusLabelModal
          open
          labels={[LABEL_A]}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
          onDelete={onDelete}
        />
      </AntApp>,
    );

    await user.click(screen.getByRole("button", { name: "删除状态 1" }));
    expect(await screen.findByText("删除失败")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "删除状态 1" }),
    ).toBeInTheDocument();
  });
});
