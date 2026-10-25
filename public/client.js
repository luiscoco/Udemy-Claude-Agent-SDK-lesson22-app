import { renderMarkdown } from "./markdown.js";
const $ = (id) => document.getElementById(id);
const button = $("run");
const rows = [];
const json = (id, value) => {
    $(id).textContent = JSON.stringify(value, null, 2);
    window.Prism?.highlightElement($(id));
};
const calls = [];
function receive(e) {
    rows.push(e);
    if (e.type === "options")
        json("options", e.options);
    if (e.type === "initialized") {
        $("session").textContent = e.sessionId;
        json("init", e);
        json("discovery", {
            availableTools: e.tools,
            note: "tools: [] removes built-ins; configured MCP tools remain.",
        });
    }
    if (e.type === "handler") {
        calls.push(e.call);
        json("handlers", calls);
    }
    if (e.type === "answer")
        renderMarkdown($("answer"), e.text);
    if (e.type === "result") {
        $("status").textContent = e.status;
        $("cost").textContent = "$" + e.costUsd.toFixed(5);
        renderMarkdown($("answer"), e.text);
    }
    if (e.type === "evidence") {
        json("evidence", {
            mode: e.mode,
            builtInsAbsent: e.builtInsAbsent,
            handlerCount: e.handlerCalls.length,
            defaultHoursObserved: e.defaultHoursObserved,
            explicitHoursObserved: e.explicitHoursObserved,
            permissionRequests: e.permissionRequests,
            attemptedTools: e.attemptedTools,
            availableTools: e.availableTools,
            calls: e.handlerCalls.map((call) => ({
                name: call.name,
                args: call.args,
                effectiveHours: call.effectiveHours,
                ok: call.ok,
                httpStatus: call.httpStatus,
            })),
        });
        const tr = document.createElement("tr");
        for (const value of [
            e.mode,
            e.handlerCalls.map((c) => c.name).join(", ") || "No handler ran",
            String(e.handlerCalls.length),
            String(e.permissionRequests.length),
            e.defaultHoursObserved
                ? "12 (omitted)"
                : e.explicitHoursObserved
                    ? "6 (explicit)"
                    : "—",
        ]) {
            const td = document.createElement("td");
            td.textContent = value;
            tr.append(td);
        }
        $("history").append(tr);
    }
    if (e.type === "error" || e.type === "notice")
        $("notice").textContent = e.text;
    if (e.type === "error")
        $("status").textContent = "Could not finish";
    if (["message", "tool", "handler", "result", "error"].includes(e.type)) {
        const li = document.createElement("li");
        li.textContent = JSON.stringify(e);
        $("events").append(li);
    }
}
button.onclick = async () => {
    button.disabled = true;
    calls.length = 0;
    $("answer").replaceChildren();
    $("events").replaceChildren();
    $("notice").textContent = "";
    $("status").textContent = "Running…";
    for (const id of ["init", "discovery", "handlers", "evidence"])
        json(id, {});
    $("session").textContent = "—";
    $("cost").textContent = "—";
    const config = {
        mode: $("mode").value,
    };
    try {
        const response = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
        });
        if (!response.ok)
            throw new Error(await response.text());
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let pending = "";
        while (true) {
            const { done, value } = await reader.read();
            pending += decoder.decode(value, { stream: !done });
            const lines = pending.split("\n");
            pending = lines.pop();
            for (const line of lines)
                if (line.trim())
                    receive(JSON.parse(line));
            if (done)
                break;
        }
        if ($("status").textContent === "Running…")
            $("status").textContent = "No final result";
    }
    catch (error) {
        $("status").textContent = "Could not finish";
        $("notice").textContent =
            error instanceof Error ? error.message : "Request failed.";
    }
    finally {
        button.disabled = false;
    }
};
$("download").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "lesson22-observations.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
fetch("/api/config")
    .then((r) => r.json())
    .then((c) => {
    $("configuration").textContent = c.ready
        ? "Key configured on server · " + c.model
        : "Set your key in .env and restart.";
    button.disabled = !c.ready;
});
