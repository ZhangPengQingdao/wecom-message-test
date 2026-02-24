// AI: 独立的 Supabase 客户端，连接 AFC_Ops_Manager 的数据库
// 通过 AFC_SUPABASE_URL 和 AFC_SUPABASE_ANON_KEY 环境变量配置
import { createClient } from '@supabase/supabase-js'

// AI: 这里的变量优先从 AFC 系统的环境变量读取，如果没有则回退到当前项目的默认变量
// 使用占位符防止 build 阶段因为缺少环境变量而报错
const afcSupabaseUrl = process.env.AFC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const afcSupabaseKey = process.env.AFC_SUPABASE_SERVICE_ROLE_KEY || process.env.AFC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

export const afcSupabase = createClient(afcSupabaseUrl, afcSupabaseKey)

