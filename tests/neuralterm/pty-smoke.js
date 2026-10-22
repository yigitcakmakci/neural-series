const { spawn } = require("child_process");
const p = spawn(process.argv[2], ["100", "30", process.env.USERPROFILE, "cmd.exe"], { windowsHide: true, env: { ...process.env, NTPTY_DEBUG: "1" } });
let out = "";
p.stdout.on("data", d => out += d.toString("utf8"));
const frame = (t, buf) => { const h = Buffer.alloc(5); h[0] = t.charCodeAt(0); h.writeInt32LE(buf.length, 1); p.stdin.write(Buffer.concat([h, buf])); };
setTimeout(() => frame("D", Buffer.from("echo NEURAL-%COMPUTERNAME:~0,0%OK ğüş\r")), 800);
setTimeout(() => { const b = Buffer.alloc(4); b.writeInt16LE(120, 0); b.writeInt16LE(40, 2); frame("R", b); frame("D", Buffer.from("exit 7\r")); }, 1600);
p.stderr.on("data", d => process.stdout.write("[stderr] " + d)); p.on("exit", code => { console.log("exit code:", code); console.log("saw output:", /NEURAL-OK ğüş/.test(out), "| VT sequences:", /\x1b\[/.test(out)); });
setTimeout(() => { console.log("timeout; output so far:", JSON.stringify(out.slice(-300))); p.kill(); }, 8000).unref();

