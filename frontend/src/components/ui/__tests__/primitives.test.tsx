import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AlertDialog } from "../AlertDialog";
import { Collapsible } from "../Collapsible";
import { DropdownMenu } from "../DropdownMenu";
import { Popover } from "../Popover";
import { Tooltip } from "../Tooltip";

describe("Stage Ledger headless primitives", () => {
  test("Collapsible supports in-place disclosure", async () => {
    // 测试点：曲目和 Event 阵容使用的 Collapsible 能保持触发器与内容的 aria 状态同步。
    const user = userEvent.setup();
    render(
      <Collapsible.Root>
        <Collapsible.Trigger>展开曲目</Collapsible.Trigger>
        <Collapsible.Content>曲目细节</Collapsible.Content>
      </Collapsible.Root>,
    );

    await user.click(screen.getByRole("button", { name: "展开曲目" }));
    expect(screen.getByText("曲目细节")).toBeVisible();
    expect(screen.getByRole("button", { name: "展开曲目" })).toHaveAttribute("data-state", "open");
  });

  test("Popover exposes share actions without replacing page context", async () => {
    // 测试点：分享操作使用 Popover，打开后内容具有独立 dialog 语义。
    const user = userEvent.setup();
    render(
      <Popover.Root>
        <Popover.Trigger>分享</Popover.Trigger>
        <Popover.Content>永久地址</Popover.Content>
      </Popover.Root>,
    );

    await user.click(screen.getByRole("button", { name: "分享" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("永久地址");
  });

  test("Tooltip provides delayed icon help", async () => {
    // 测试点：Tooltip 只承载操作帮助文本，不承载曲目或事件的主要信息。
    const user = userEvent.setup();
    render(
      <Tooltip.Provider delayDuration={0}>
        <Tooltip.Root>
          <Tooltip.Trigger aria-label="帮助">?</Tooltip.Trigger>
          <Tooltip.Content>这是帮助文本</Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>,
    );

    await user.hover(screen.getByRole("button", { name: "帮助" }));
    expect(await screen.findByText("这是帮助文本")).toBeVisible();
  });

  test("DropdownMenu groups mobile overflow actions", async () => {
    // 测试点：移动端更多操作通过 DropdownMenu 呈现可键盘访问的 menuitem。
    const user = userEvent.setup();
    render(
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>更多</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item>复制地址</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>,
    );

    await user.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByRole("menuitem", { name: "复制地址" })).toBeVisible();
  });

  test("AlertDialog keeps destructive confirmation explicit", async () => {
    // 测试点：AlertDialog 只用于需要确认的破坏性动作，并提供可取消的 dialog。
    const user = userEvent.setup();
    render(
      <AlertDialog.Root>
        <AlertDialog.Trigger>删除资料</AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Content>
            <AlertDialog.Title>确认删除</AlertDialog.Title>
            <AlertDialog.Description>此操作不可撤销。</AlertDialog.Description>
            <AlertDialog.Cancel>取消</AlertDialog.Cancel>
            <AlertDialog.Action>确认删除</AlertDialog.Action>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>,
    );

    await user.click(screen.getByRole("button", { name: "删除资料" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("此操作不可撤销");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
