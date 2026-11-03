// This computer's CPU, memory and GPU use as one sidebar row, read every few seconds. When less than MIN_FREE% of
// memory is free it shares `system.load` with low: true, and t3-new-menu won't start agents here until it recovers.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, theme, setShared } from "herdr";

export const MIN_FREE = 15;
const POLL = 5000;

// top's second sample (the first counts since boot), macOS's own free-memory figure (what memory pressure is
// judged by, counting cache it can drop), and the GPU's utilization. Each is null when its command gives nothing.
export function parse(top, pressure, gpu) {
  const idle = [...(top ?? "").matchAll(/([\d.]+)% idle/g)].pop()?.[1];
  const free = /free percentage: (\d+)%/.exec(pressure ?? "")?.[1];
  const busy = /"Device Utilization %"=(\d+)/.exec(gpu ?? "")?.[1];
  return {
    cpu: idle === undefined ? null : Math.max(0, 100 - Number(idle)),
    free: free === undefined ? null : Number(free),
    gpu: busy === undefined ? null : Number(busy),
  };
}

const out = (cmd, args) => exec(cmd, args).then((r) => (r.code === 0 ? r.stdout : null), () => null);

export default class System extends View {
  init(_props, cx) {
    this.load = { cpu: null, free: null, gpu: null };
    this.busy = false;
    this.read(cx);
    cx.timer.every(POLL, (cx) => this.read(cx));
  }

  read(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      const [top, pressure, gpu] = await Promise.all([
        out("top", ["-l", "2", "-n", "0", "-s", "1"]),
        out("memory_pressure", ["-Q"]),
        out("ioreg", ["-r", "-d", "1", "-c", "IOAccelerator"]),
      ]);
      this.busy = false;
      this.load = parse(top, pressure, gpu);
      const { free } = this.load;
      setShared("system.load", { free, low: free !== null && free < MIN_FREE, min: MIN_FREE, at: Date.now() });
      cx.notify();
    });
  }

  render() {
    const t = theme(), { cpu, free, gpu } = this.load, low = free !== null && free < MIN_FREE;
    const stat = (id, label, used, alarm) => h_flex().id(id).gap(4).items_center()
      .accessibility_label(`${label} ${used === null ? "unknown" : `${Math.round(used)}% used`}`)
      .child(div().text_color(alarm ? t.blocked : t.dim).child(label))
      .child(div().text_color(alarm ? t.blocked : used >= 80 ? t.ansi3 : t.muted).child(used === null ? "–" : `${Math.round(used)}%`));
    return h_flex().id("system").size_full().pl(16).pr(12).gap(14).items_center().bg(t.chrome).text_size(11)
      .when(low, (el) => el.tooltip(`Only ${free}% of memory is free. New agents wait until ${MIN_FREE}% is.`))
      .child(stat("system-cpu", "CPU", cpu, false))
      .child(stat("system-mem", "Mem", free === null ? null : 100 - free, low))
      .when(gpu !== null, (el) => el.child(stat("system-gpu", "GPU", gpu, false)));
  }
}
