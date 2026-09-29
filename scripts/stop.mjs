import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'

if (process.platform === 'win32') {
  console.error(
    'This stop command requires macOS or Linux. On Windows, press Ctrl-C in each workshop terminal.',
  )
  process.exit(1)
}

const root = realpathSync(process.cwd())
const workshopCommand =
  /(?:^|\s)(?:server\/(?:operator|agent)\.ts|service\/checkout\.ts)(?:\s|$)|\/node_modules\/\.bin\/(?:vite|vitepress)(?:\s|$)|^inngest dev -u http:\/\/127\.0\.0\.1:3002\/api\/inngest(?:\s|$)/

function commandOutput(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' })
}

function processCwd(pid) {
  try {
    const line = commandOutput('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
      .split('\n')
      .find((item) => item.startsWith('n/'))
    return line ? realpathSync(line.slice(1)) : null
  } catch {
    return null
  }
}

function workshopGroups() {
  const ownGroup = Number(commandOutput('ps', ['-p', String(process.pid), '-o', 'pgid=']).trim())
  const groups = new Set()
  for (const line of commandOutput('ps', [
    '-axww',
    '-o',
    'pid=',
    '-o',
    'pgid=',
    '-o',
    'command=',
  ]).split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) continue
    const [, pidText, groupText, command] = match
    const group = Number(groupText)
    if (group === ownGroup || !workshopCommand.test(command)) continue
    if (processCwd(Number(pidText)) === root) groups.add(group)
  }
  return groups
}

function signal(groups, name) {
  for (const group of groups) {
    try {
      process.kill(-group, name)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
}

const groups = workshopGroups()
if (!groups.size) {
  console.log('No workshop services are running.')
} else {
  signal(groups, 'SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const remaining = workshopGroups()
  if (remaining.size) signal(remaining, 'SIGKILL')
  console.log(
    'Stopped the workshop services. Ports 3001, 3002, 3004, 5173, 5174, and 8288 are available.',
  )
}
