import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { ConsoleConfirmDialog } from "../ConsoleConfirmDialog";
import { ConsoleDraftProvider, useConsoleDraftGuard, useConsoleLeaveGuard, type ConsoleLeaveGuard } from "../ConsoleDraftGuard";

function Confirmation({ save }: { save: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>保存修改</button>
    {open && <ConsoleConfirmDialog title="确认更新歌曲 #9" onClose={() => setOpen(false)}
      onConfirm={async () => { await save(); setOpen(false); }}
      changes={[{ field: "名称", before: "旧名称", after: "新名称" }]}>{null}</ConsoleConfirmDialog>}
  </>;
}

// 测试点：保存失败保留变更预览，重试成功后完成提交。
test("retains failed confirmation until successful retry", async () => {
  const user = userEvent.setup();
  let reject!: (error: Error) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, rejectSave) => { reject = rejectSave; }))
    .mockResolvedValueOnce(undefined);
  render(<Confirmation save={save} />);
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("旧名称")).toBeInTheDocument();
  expect(within(dialog).getByText("新名称")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "确认更新" }));
  reject(new Error("保存失败，请重试"));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("保存失败，请重试");
  expect(within(dialog).getByText("旧名称")).toBeInTheDocument();
  expect(within(dialog).getByText("新名称")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "确认更新" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(save).toHaveBeenCalledTimes(2);
});

function DraftEditor() {
  const [name, setName] = useState("原值");
  const [left, setLeft] = useState(false);
  const leave = useConsoleLeaveGuard();
  const { guard, dialog } = useConsoleDraftGuard({ dirty: name !== "原值", label: "场馆 #3",
    onDiscard: () => setName("原值") });
  return <><input aria-label="场馆名称" value={name} onChange={event => setName(event.target.value)} />
    <button onClick={() => guard(() => setName("另一个场馆"))}>切换场馆</button>
    <button onClick={() => leave(() => setLeft(true))}>离开控制台</button>
    {left && <p role="status">已离开</p>}{dialog}</>;
}

// 测试点：对象切换与离开控制台共用草稿保护，取消保留输入，确认放弃后才导航。
test("guards object changes, Console navigation and browser unload", async () => {
  const user = userEvent.setup();
  render(<ConsoleDraftProvider><DraftEditor /></ConsoleDraftProvider>);
  const input = screen.getByLabelText("场馆名称");
  await user.type(input, "修改");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "切换场馆" }));
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(input).toHaveValue("原值修改");
  await user.click(screen.getByRole("button", { name: "离开控制台" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("场馆 #3");
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(await screen.findByRole("status")).toHaveTextContent("已离开");
  expect(input).toHaveValue("原值");
  const cleanUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(cleanUnload);
  expect(cleanUnload.defaultPrevented).toBe(false);
});

// 测试点：更新确认没有变化字段时不能触发保存，即使调用页面忘记禁用按钮。
test("blocks an update with no changed values", async () => {
  const save = vi.fn();
  render(<ConsoleConfirmDialog title="确认更新专辑 #4" onClose={vi.fn()} onConfirm={save}
    changes={[{ field: "名称", before: "专辑", after: "专辑" }]}>{null}</ConsoleConfirmDialog>);
  expect(screen.getByRole("button", { name: "确认更新" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "确认更新" }));
  expect(save).not.toHaveBeenCalled();
});

function MultipleDrafts() {
  const [song, setSong] = useState("歌曲草稿");
  const [album, setAlbum] = useState("专辑草稿");
  const leave = useConsoleLeaveGuard();
  useConsoleDraftGuard({ dirty: song !== "原歌曲", label: "歌曲 #1", onDiscard: () => setSong("原歌曲") });
  useConsoleDraftGuard({ dirty: album !== "原专辑", label: "专辑 #2", onDiscard: () => setAlbum("原专辑") });
  return <><p>{song}</p><p>{album}</p><button onClick={() => leave(() => {})}>切换页面</button></>;
}

// 测试点：同页多个草稿只确认一次，取消保留全部草稿，确认放弃同时撤销全部修改。
test("confirms multiple drafts together without partially discarding on cancellation", async () => {
  const user = userEvent.setup();
  render(<ConsoleDraftProvider><MultipleDrafts /></ConsoleDraftProvider>);
  await user.click(screen.getByRole("button", { name: "切换页面" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("歌曲 #1");
  expect(screen.getByRole("dialog")).toHaveTextContent("专辑 #2");
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByText("歌曲草稿")).toBeInTheDocument();
  expect(screen.getByText("专辑草稿")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "切换页面" }));
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(screen.getByText("原歌曲")).toBeInTheDocument();
  expect(screen.getByText("原专辑")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

// 测试点：对象切换确认期间暂停导航，取消后完整保留草稿。
test("blocks another navigation while an object discard is pending", async () => {
  const user = userEvent.setup();
  let leave: ConsoleLeaveGuard | null = null;
  const proceed = vi.fn();
  render(<ConsoleDraftProvider onLeaveGuard={guard => { leave = guard; }}><DraftEditor /></ConsoleDraftProvider>);
  await user.type(screen.getByLabelText("场馆名称"), "修改");
  await user.click(screen.getByRole("button", { name: "切换场馆" }));
  act(() => { leave?.(proceed); });
  expect(proceed).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByLabelText("场馆名称")).toHaveValue("原值修改");
});
