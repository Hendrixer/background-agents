import { connect, createServer } from 'node:net'

const names = {
  3001: 'operator API',
  3002: 'agent endpoint',
  3004: 'checkout service',
  5173: 'dashboard',
  5174: 'lesson notes',
  8288: 'Inngest Dev Server',
}

function hostPortIsFree(port, host) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false)
      else reject(error)
    })
    server.listen(port, host, () => server.close(() => resolve(true)))
  })
}

function hostPortAcceptsConnections(port, host) {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host, timeout: 500 })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', (error) => {
      if (['ECONNREFUSED', 'EADDRNOTAVAIL', 'ENETUNREACH'].includes(error.code)) resolve(false)
      else reject(error)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(true)
    })
  })
}

async function portIsFree(port) {
  for (const host of ['127.0.0.1', '::1']) {
    try {
      if (await hostPortAcceptsConnections(port, host)) return false
      if (!(await hostPortIsFree(port, host))) return false
    } catch (error) {
      if (error.code !== 'EAFNOSUPPORT' && error.code !== 'EADDRNOTAVAIL') throw error
    }
  }
  return true
}

for (const value of process.argv.slice(2)) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${value}`)
    process.exitCode = 1
    continue
  }
  try {
    if (!(await portIsFree(port))) {
      console.error(
        `Port ${port} is already in use (${names[port] ?? 'workshop service'}). Stop the existing workshop process before starting another copy.`,
      )
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`Cannot check port ${port}: ${error.message}`)
    process.exitCode = 1
  }
}
