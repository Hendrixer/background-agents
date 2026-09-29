const url = process.argv[2]
if (!url) {
  console.error('Pass the service health URL to wait for.')
  process.exit(1)
}

for (let attempt = 0; attempt < 100; attempt++) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) })
    if (response.ok) process.exit(0)
  } catch {
    // The service has not started listening yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 100))
}

console.error(`Timed out waiting for ${url}. Check the operator API startup output.`)
process.exit(1)
