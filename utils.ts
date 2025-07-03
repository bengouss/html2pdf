import fs from "fs"
import {spawn, exec, SpawnOptionsWithoutStdio} from "child_process"

const execute = (command: string, args: string[], options?: SpawnOptionsWithoutStdio) => {
    return new Promise<void>((resolve, reject) => {
        const cp = spawn(command, args, options)
        cp.on("spawn", () => {
            console.log("spawned:", `${command} ${args ? args.join(" ") : ""}`)
        })
        cp.on("error", (err) => {
            console.log("ERROR", err)
        })
        cp.on("exit", (code, signal) => {
            console.log("EXIT", code, signal)
        })
        cp.on("close", (code, signal) => {
            console.log("CLOSE", code, signal)
            if(code === 0)  resolve()
            else reject()
        })
        cp.on("disconnect", () => {
            console.log("DISCONNECT")
        })
        cp.on("message", (m) => {
            console.log("MESSAGE", m)
        })

        cp.stdout.on('data', (data) => {
            console.log(`STDOUT ${data}`);
        });
        
        cp.stderr.on('data', (data) => {
            console.log(`STDERR ${data}`);
        });

        // cp.on("message", resolve)
        cp.on("error", reject)
    })
}

const untar = () => execute("tar", ["-xzf", `${process.env.LAMBDA_TASK_ROOT}/pki_nssdb.tgz`, "-C", "/tmp"])

const list = (folder:string) => {
    fs.readdirSync(folder).forEach(file => {
        console.log("LIST", folder, file);
    })
}

const envs = () => execute("env", [], {})

const ln = (from:string, to:string) => execute("ln", ["-s", from, to])

export default {
    untar,
    list,
    envs,
    execute,
    ln
}