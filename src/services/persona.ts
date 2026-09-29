// ---------- 人格设置（2026-09-25，参考 WorkBuddy 的回复风格/自定义指令/称呼身份/人设） ----------
// 把设置里的个性化人格拼成一段 system prompt 附加块，注入对话与任务链路。
// 全部可选项：任何一项未设置时对应段落不出现，块为空串时不注入。

export type ReplyStyleId = 'default' | 'professional' | 'friendly' | 'concise' | 'creative'

export const REPLY_STYLES: Array<{ id: ReplyStyleId; label: string; desc: string; prompt: string }> = [
  { id: 'default', label: '默认', desc: '不设定特定风格', prompt: '' },
  {
    id: 'professional',
    label: '专业严谨',
    desc: '清晰、准确、值得信赖',
    prompt: '回复风格：专业严谨。表述清晰、准确、值得信赖；先给可靠结论再给依据，不夸大、不含糊。',
  },
  {
    id: 'friendly',
    label: '亲人和善',
    desc: '温暖、平易近人、鼓励支持',
    prompt: '回复风格：亲人和善。温暖、平易近人、多鼓励支持；语气自然亲切，但不牺牲信息量。',
  },
  {
    id: 'concise',
    label: '直言不讳',
    desc: '简明扼要、不废话、直击要点',
    prompt: '回复风格：直言不讳。简明扼要、不废话、直击要点；能一句话说清就不写两句，少铺垫少客套。',
  },
  {
    id: 'creative',
    label: '天马行空',
    desc: '创意发散、脑洞大开',
    prompt: '回复风格：天马行空。创意发散、善用比喻、敢提非常规方案，但落地方案仍要靠谱可行。',
  },
]

/** 人格设置 → system prompt 附加块（空串 = 无任何人格设置，不注入） */
export function buildPersonaBlock(cfg: any): string {
  if (!cfg) return ''
  const parts: string[] = []
  const name = String(cfg.aiName ?? '').trim()
  const nick = String(cfg.userNickname ?? '').trim()
  const persona = String(cfg.personaPrompt ?? '').trim()
  const instructions = String(cfg.customInstructions ?? '').trim()
  if (name) parts.push(`你的名字是「${name}」，对话中以此自称，不要自称底层模型名。`)
  if (nick) parts.push(`对用户的称呼是「${nick}」，交流时自然使用这个称呼。`)
  const style = REPLY_STYLES.find(s => s.id === (cfg.replyStyle ?? 'default'))
  if (style && style.prompt) parts.push(style.prompt)
  if (persona) parts.push(`用户为你定义的人设 / 人格描述（与你的人格设定保持一致）：\n${persona.slice(0, 2000)}`)
  if (instructions) parts.push(`用户的自定义指令（后续所有对话都必须遵守）：\n${instructions.slice(0, 1500)}`)
  if (parts.length === 0) return ''
  return '\n\n# 人格与偏好（用户在设置中自定义，必须遵守）\n' + parts.join('\n')
}
