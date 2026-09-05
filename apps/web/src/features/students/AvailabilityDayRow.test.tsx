import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { AvailabilityDayRow } from "./AvailabilityDayRow";
import type { WeeklyPatternDay } from "./availabilityApi";

function Harness({ initial }: { initial: WeeklyPatternDay }) {
  const [value, setValue] = useState(initial);
  return (
    <AvailabilityDayRow
      label="周一"
      value={value}
      onChange={(next) => setValue(next as WeeklyPatternDay)}
    />
  );
}

describe("AvailabilityDayRow", () => {
  it("zeros a disabled day and restores its last positive duration", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          dayOfWeek: 1,
          available: true,
          availableMinutes: 90,
          devicePolicyOverride: null,
        }}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "周一可学习" });
    const minutes = screen.getByRole("spinbutton", { name: "周一可用分钟" });
    expect(minutes).toHaveValue("90");

    await user.click(toggle);
    expect(minutes).toBeDisabled();
    expect(minutes).toHaveValue("0");

    await user.click(toggle);
    expect(minutes).toBeEnabled();
    expect(minutes).toHaveValue("90");
  });

  it("does not invent a duration when no previous value exists", () => {
    render(
      <Harness
        initial={{
          dayOfWeek: 1,
          available: true,
          availableMinutes: 0,
          devicePolicyOverride: null,
        }}
      />,
    );

    expect(screen.getByText("请填写可用分钟")).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "周一可用分钟" }),
    ).toHaveValue("0");
  });
});
