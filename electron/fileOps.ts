/**
 * 文件操作辅助函数（纯函数，可在测试里直接 transpile 运行）。
 * 集中放递归复制与追加换行安全逻辑，供 agent 工具的 IPC 处理器复用。
 */
import * as fs from 'fs'
import * as path from 'path'

/**
 * 递归复制。src 是目录时，dst 也建成目录并递归复制其内容；
 * src 是文件时，确保目标父目录存在后复制。
 * 用于 copy_file 支持「整目录复制」。
 */
export function copyRecursive(src: string, dst: string): void {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      copyRecursive(path.join(src, entry.name), path.join(dst, entry.name))
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
}

/**
 * 追加内容到文件末尾，但若原文件不以换行结尾则先补一个换行，
 * 防止「上一行末尾」与「本次追加开头」被拼到同一行。
 * 文件不存在或为空时直接写入（不补换行）。
 */
export function appendWithNewline(fp: string, content: string): void {
  let sep = ''
  if (fs.existsSync(fp)) {
    const existing = fs.readFileSync(fp, 'utf-8')
    if (existing.length > 0 && !existing.endsWith('\n')) sep = '\n'
  }
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.appendFileSync(fp, sep + content, 'utf-8')
}
