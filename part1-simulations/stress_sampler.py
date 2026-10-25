"""stress_sampler.py — resource sampler for stress.sh (Linux, cgroup v2).

    python3 stress_sampler.py <out.csv> <liferay-container> [other-container ...]

Every 2 s writes one CSV row: elapsed seconds, host busy cores, per-container CPU
cores and memory (from the container's cgroup, so it is cheap and exact), the k6
process's CPU cores, and — every 4th sample — the Liferay JVM heap (old-gen used
MB, full-GC count) via `jstat` inside the container. Runs until killed.
"""
import csv
import os
import subprocess
import sys
import time

INTERVAL = 2.0
out_path, containers = sys.argv[1], sys.argv[2:]


def cgroup(name):
    cid = subprocess.run(["docker", "inspect", "-f", "{{.Id}}", name], capture_output=True, text=True).stdout.strip()
    path = f"/sys/fs/cgroup/system.slice/docker-{cid}.scope"
    return path if os.path.isdir(path) else None


def cg_usage_us(path):
    for line in open(f"{path}/cpu.stat"):
        if line.startswith("usage_usec"):
            return int(line.split()[1])
    return 0


def cg_mem_mb(path):
    return int(open(f"{path}/memory.current").read()) / 2**20


def host_busy_jiffies():
    v = [int(x) for x in open("/proc/stat").readline().split()[1:]]
    idle = v[3] + v[4]
    return sum(v) - idle, sum(v)


def k6_jiffies():
    total = 0
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            if open(f"/proc/{pid}/comm").read().strip() != "k6":
                continue
            f = open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()
            total += int(f[11]) + int(f[12])
        except OSError:
            pass
    return total


def jstat(name):
    cmd = "jstat -gc $(pgrep -f org.apache.catalina.startup.Bootstrap | head -1)"
    r = subprocess.run(["docker", "exec", name, "sh", "-c", cmd], capture_output=True, text=True, timeout=10)
    lines = r.stdout.split()
    if not lines:
        return "", ""
    head, vals = r.stdout.splitlines()[0].split(), r.stdout.splitlines()[1].split()
    row = dict(zip(head, vals))
    return f"{float(row['OU']) / 1024:.0f}", row["FGC"]


hz = os.sysconf("SC_CLK_TCK")
cgs = {c: cgroup(c) for c in containers}
cols = ["t", "host_cores"] + [f"{c}_cores" for c in containers] + [f"{c}_mem_mb" for c in containers] + ["k6_cores", "heap_old_mb", "full_gc"]
w = csv.writer(open(out_path, "w", buffering=1))
w.writerow(cols)

t0 = time.time()
prev_host, prev_k6 = host_busy_jiffies(), k6_jiffies()
prev_cg = {c: cg_usage_us(p) if p else 0 for c, p in cgs.items()}
prev_t = time.time()
n = 0
while True:
    time.sleep(INTERVAL)
    now = time.time()
    dt = now - prev_t
    busy, _ = host_busy_jiffies()
    k6 = k6_jiffies()
    row = [f"{now - t0:.0f}", f"{(busy - prev_host[0]) / hz / dt:.2f}"]
    mems = []
    for c, p in cgs.items():
        u = cg_usage_us(p) if p else 0
        row.append(f"{(u - prev_cg[c]) / 1e6 / dt:.2f}")
        mems.append(f"{cg_mem_mb(p):.0f}" if p else "")
        prev_cg[c] = u
    row += mems
    row.append(f"{max(0, k6 - prev_k6) / hz / dt:.2f}")
    heap, fgc = ("", "")
    if n % 4 == 0:
        try:
            heap, fgc = jstat(containers[0])
        except Exception:  # noqa: BLE001 — container restarting / jstat busy: leave blank
            pass
    row += [heap, fgc]
    w.writerow(row)
    prev_host, prev_k6, prev_t = (busy, 0), k6, now
    n += 1
