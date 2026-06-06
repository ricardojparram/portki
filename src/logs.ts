import { readlink, stat } from "node:fs/promises";

export async function fetchProcessLogs(
  pid: number,
  container?: { id: string; engine: "docker" | "podman" }
): Promise<string> {
  // 1. Docker/Podman Container Logs
  if (container?.id) {
    try {
      const proc = Bun.spawn([container.engine, "logs", "--tail", "20", container.id]);
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      return (stdout + stderr).trim() || "[No hay logs disponibles para este contenedor]";
    } catch (err: any) {
      return `[Error al obtener logs de ${container.engine}: ${err.message}]`;
    }
  }

  // 2. Local Process Logs via /proc/<pid>/fd/1
  const fd1Path = `/proc/${pid}/fd/1`;

  try {
    const target = await readlink(fd1Path);

    // If it points to a TTY/pts
    if (target.startsWith("/dev/pts/") || target.startsWith("/dev/tty")) {
      return `[El proceso está escribiendo directamente en la terminal (${target}).\nNo es posible interceptar su salida en tiempo real sin alterar la pantalla].`;
    }

    // If it points to a pipe or socket
    if (target.startsWith("pipe:") || target.startsWith("socket:")) {
      return `[La salida estándar está redirigida a un pipe o socket (${target}).\nCapturar logs en tiempo real de tuberías no está soportado en este modo].`;
    }

    // If it points to a regular file, read the tail of the file
    try {
      const fileStats = await stat(target);
      if (fileStats.isFile()) {
        const proc = Bun.spawn(["tail", "-n", "20", target]);
        const logs = await new Response(proc.stdout).text();
        return logs.trim() || `[El archivo de log está vacío: ${target}]`;
      }
    } catch {
      // If we can't read/stat the file path resolved
      return `[La salida está redirigida a un archivo: ${target}\n(No se pudo abrir o leer el archivo de logs)].`;
    }

    return `[La salida estándar apunta a: ${target}]`;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return `[No se encontró el proceso o no tiene descriptores de salida activos (PID: ${pid})]`;
    }
    if (err.code === "EACCES" || err.code === "EPERM") {
      return `[Permiso denegado al leer /proc/${pid}/fd/1.\nSe requiere correr como root o el mismo usuario propietario].`;
    }
    return `[No se pudieron obtener los logs para el PID ${pid}: ${err.message}]`;
  }
}
