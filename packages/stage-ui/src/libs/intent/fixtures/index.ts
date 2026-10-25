import type { IntentSample, IntentSampleGroup } from '../evaluate'

/**
 * The starter evaluation set.
 *
 * Labels are product judgement, not rule output. Several samples are here
 * because the rules answer them wrong: `她今天特别没精神` has no medical word,
 * and `宝宝黄胆怎么看` spells the term incorrectly the way a spoken message
 * usually does. A set that only contains sentences the rules already catch
 * proves nothing.
 *
 * This is a starting set, not the target one. The design doc asks for 300
 * samples with a held-out final set; keep this one for tuning and build the
 * larger set from real de-identified messages.
 */

/** Human-readable name for each slice, used by the report table. */
export const intentSampleGroupLabels: Record<IntentSampleGroup, string> = {
  'medical-explicit': '明确医学问题',
  'medical-implicit': '隐含医学担忧',
  'medical-knowledge': '医学知识问题',
  'hospital-process': '就医流程问题',
  'chitchat': '普通闲聊',
  'short-reply': '短句、指代和应答',
  'asr-noise': 'ASR 错字和无标点',
}

export const intentSamples: IntentSample[] = [
  // ── 明确医学问题 ────────────────────────────────────────────────
  { id: 'med-01', group: 'medical-explicit', expected: 'medical', input: '宝宝黄疸怎么看' },
  { id: 'med-02', group: 'medical-explicit', expected: 'medical', input: '我今天恶露比昨天多' },
  { id: 'med-03', group: 'medical-explicit', expected: 'medical', input: '乳房胀痛还能喂奶吗' },
  { id: 'med-04', group: 'medical-explicit', expected: 'medical', input: '伤口有点红' },
  { id: 'med-05', group: 'medical-explicit', expected: 'medical', input: '宝宝今天吐奶三次' },
  { id: 'med-06', group: 'medical-explicit', expected: 'medical', input: '脐带还没掉正常吗' },
  { id: 'med-07', group: 'medical-explicit', expected: 'medical', input: '我体温37.8' },
  { id: 'med-08', group: 'medical-explicit', expected: 'medical', input: '便秘好几天了' },
  { id: 'med-09', group: 'medical-explicit', expected: 'medical', input: '腰疼得厉害' },
  { id: 'med-10', group: 'medical-explicit', expected: 'medical', input: '宝宝大便有点稀' },
  { id: 'med-11', group: 'medical-explicit', expected: 'medical', input: '漏尿怎么办' },
  { id: 'med-12', group: 'medical-explicit', expected: 'medical', input: '血压有点高' },
  { id: 'med-13', group: 'medical-explicit', expected: 'medical', input: '掉头发很严重' },
  { id: 'med-14', group: 'medical-explicit', expected: 'medical', input: '宝宝吃奶少' },
  { id: 'med-15', group: 'medical-explicit', expected: 'medical', input: '出血比昨天多' },
  { id: 'med-16', group: 'medical-explicit', expected: 'medical', input: '宝宝今天体温37.9' },
  { id: 'med-17', group: 'medical-explicit', expected: 'medical', input: '我伤口有点疼' },
  { id: 'med-18', group: 'medical-explicit', expected: 'medical', input: '恶露颜色变深了' },
  { id: 'med-19', group: 'medical-explicit', expected: 'medical', input: '宝宝脐带有点渗血' },
  { id: 'med-20', group: 'medical-explicit', expected: 'medical', input: '乳房有个硬块' },
  { id: 'med-21', group: 'medical-explicit', expected: 'medical', input: '宝宝一天没拉大便' },

  // ── 隐含医学担忧（没有实体词，规则容易漏）──────────────────────
  // This group holds the boundary, so it carries one sample a person judged as
  // chat: `她今天特别没精神` describes a state, not a symptom. Telling the two
  // apart is the whole job, so the group must hold both answers.
  { id: 'imp-01', group: 'medical-implicit', expected: 'chat', input: '她今天特别没精神' },
  { id: 'imp-02', group: 'medical-implicit', expected: 'medical', input: '我有点不放心' },
  { id: 'imp-03', group: 'medical-implicit', expected: 'medical', input: '这样下去会不会有事' },
  { id: 'imp-04', group: 'medical-implicit', expected: 'medical', input: '这个颜色看着不太对' },
  { id: 'imp-05', group: 'medical-implicit', expected: 'medical', input: '需要去医院看看吗' },
  { id: 'imp-06', group: 'medical-implicit', expected: 'medical', input: '会不会是我多想了' },
  { id: 'imp-07', group: 'medical-implicit', expected: 'medical', input: '一直这样是不是不正常' },
  { id: 'imp-08', group: 'medical-implicit', expected: 'medical', input: '我担心落下毛病' },
  { id: 'imp-09', group: 'medical-implicit', expected: 'medical', input: '要紧吗' },
  { id: 'imp-10', group: 'medical-implicit', expected: 'medical', input: '我这样算正常吗', needsContext: true },
  { id: 'imp-11', group: 'medical-implicit', expected: 'medical', input: '要不要紧' },
  { id: 'imp-12', group: 'medical-implicit', expected: 'medical', input: '我心里没底' },
  { id: 'imp-13', group: 'medical-implicit', expected: 'medical', input: '她一直不睡觉' },
  { id: 'imp-14', group: 'medical-implicit', expected: 'medical', input: '这种常见吗' },
  { id: 'imp-15', group: 'medical-implicit', expected: 'medical', input: '需要处理吗' },
  { id: 'imp-16', group: 'medical-implicit', expected: 'medical', input: '我有点担心她' },
  { id: 'imp-17', group: 'medical-implicit', expected: 'medical', input: '该不该去看看' },

  // ── 医学知识问题（问做法，不是描述症状）────────────────────────
  { id: 'knw-01', group: 'medical-knowledge', expected: 'medical', input: '产后多久可以洗澡' },
  { id: 'knw-02', group: 'medical-knowledge', expected: 'medical', input: '能不能洗头' },
  { id: 'knw-03', group: 'medical-knowledge', expected: 'medical', input: '可以吃海鲜吗' },
  { id: 'knw-04', group: 'medical-knowledge', expected: 'medical', input: '剖宫产多久能下床' },
  { id: 'knw-05', group: 'medical-knowledge', expected: 'medical', input: '母乳要喂到几个月' },
  { id: 'knw-06', group: 'medical-knowledge', expected: 'medical', input: '产后多久来月经' },
  { id: 'knw-07', group: 'medical-knowledge', expected: 'medical', input: '产后能吹空调吗' },
  { id: 'knw-08', group: 'medical-knowledge', expected: 'medical', input: '月子里能不能刷牙' },
  { id: 'knw-09', group: 'medical-knowledge', expected: 'medical', input: '宝宝多久喂一次' },
  { id: 'knw-10', group: 'medical-knowledge', expected: 'medical', input: '产后能运动吗' },

  // ── 就医流程（能直接答的走闲聊，需要临床判断的走医学）──────────
  { id: 'prc-01', group: 'hospital-process', expected: 'chat', input: '停车方便吗' },
  { id: 'prc-02', group: 'hospital-process', expected: 'chat', input: '医保能报销吗' },
  { id: 'prc-03', group: 'hospital-process', expected: 'chat', input: '门诊几点下班' },
  { id: 'prc-04', group: 'hospital-process', expected: 'chat', input: '挂号要带什么材料' },
  { id: 'prc-05', group: 'hospital-process', expected: 'chat', input: '上午的号能改到下午吗' },
  { id: 'prc-06', group: 'hospital-process', expected: 'medical', input: '复查挂哪个科' },
  { id: 'prc-07', group: 'hospital-process', expected: 'chat', input: '出生证明怎么办' },
  { id: 'prc-08', group: 'hospital-process', expected: 'chat', input: '新生儿科怎么走' },
  { id: 'prc-09', group: 'hospital-process', expected: 'chat', input: '复查要带病历本吗' },

  // ── 普通闲聊 ──────────────────────────────────────────────────
  { id: 'cht-01', group: 'chitchat', expected: 'chat', input: '今天天气不错' },
  { id: 'cht-02', group: 'chitchat', expected: 'chat', input: '谢谢你' },
  { id: 'cht-03', group: 'chitchat', expected: 'chat', input: '好累啊' },
  { id: 'cht-04', group: 'chitchat', expected: 'chat', input: '我婆婆今天来了' },
  { id: 'cht-05', group: 'chitchat', expected: 'chat', input: '晚上吃什么' },
  { id: 'cht-06', group: 'chitchat', expected: 'chat', input: '你叫什么名字' },
  { id: 'cht-07', group: 'chitchat', expected: 'chat', input: '我今天心情不错' },
  { id: 'cht-08', group: 'chitchat', expected: 'chat', input: '宝宝好可爱' },
  { id: 'cht-09', group: 'chitchat', expected: 'chat', input: '我想睡一觉' },
  { id: 'cht-10', group: 'chitchat', expected: 'chat', input: '家里太乱了' },
  { id: 'cht-11', group: 'chitchat', expected: 'chat', input: '老公出差了' },
  { id: 'cht-12', group: 'chitchat', expected: 'chat', input: '你在干嘛' },
  { id: 'cht-13', group: 'chitchat', expected: 'chat', input: '我胖了好多' },
  { id: 'cht-14', group: 'chitchat', expected: 'chat', input: '好无聊' },
  { id: 'cht-15', group: 'chitchat', expected: 'chat', input: '晚安' },
  // Person words appear here on purpose: a sample that carries `宝宝` but no
  // medical content is exactly what a word list gets wrong.
  { id: 'cht-16', group: 'chitchat', expected: 'chat', input: '宝宝今晚特别乖' },
  { id: 'cht-17', group: 'chitchat', expected: 'chat', input: '我今天哭了两次' },
  { id: 'cht-18', group: 'chitchat', expected: 'chat', input: '我妈明天来看我' },
  { id: 'cht-19', group: 'chitchat', expected: 'chat', input: '想喝奶茶' },
  { id: 'cht-20', group: 'chitchat', expected: 'chat', input: '宝宝笑起来真好看' },

  // ── 短句、指代和应答 ──────────────────────────────────────────
  { id: 'sht-01', group: 'short-reply', expected: 'chat', input: '好的' },
  { id: 'sht-02', group: 'short-reply', expected: 'chat', input: '嗯' },
  { id: 'sht-03', group: 'short-reply', expected: 'chat', input: '知道了' },
  { id: 'sht-04', group: 'short-reply', expected: 'chat', input: '收到' },
  { id: 'sht-05', group: 'short-reply', expected: 'chat', input: '行' },
  { id: 'sht-06', group: 'short-reply', expected: 'chat', input: '谢谢' },
  {
    id: 'sht-07',
    group: 'short-reply',
    expected: 'medical',
    needsContext: true,
    previous: '宝宝黄疸14，医生说观察',
    input: '那还要复查吗',
  },
  { id: 'sht-08', group: 'short-reply', expected: 'chat', input: '没事' },
  {
    id: 'sht-09',
    group: 'short-reply',
    expected: 'medical',
    needsContext: true,
    previous: '我伤口有点疼',
    input: '那个呢',
  },

  // ── ASR 错字和无标点 ──────────────────────────────────────────
  { id: 'asr-01', group: 'asr-noise', expected: 'medical', input: '宝宝黄胆怎么看' },
  { id: 'asr-02', group: 'asr-noise', expected: 'medical', input: '我恶漏变多了' },
  { id: 'asr-03', group: 'asr-noise', expected: 'medical', input: '奶水不够怎么办' },
  { id: 'asr-04', group: 'asr-noise', expected: 'medical', input: '宝宝今天一直哭闹' },
  { id: 'asr-05', group: 'asr-noise', expected: 'medical', input: '宝宝肚齐有点红' },
  { id: 'asr-06', group: 'asr-noise', expected: 'medical', input: '我伤口有点羊' },
]
