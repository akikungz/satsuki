import { exec } from "child_process";
import { promisify } from "util";
import type { CommandRunner } from "../../application/ports";

const execAsync = promisify(exec);

export class ShellCommandRunner implements CommandRunner {
  async run(command: string): Promise<void> {
    await execAsync(command);
  }
}
