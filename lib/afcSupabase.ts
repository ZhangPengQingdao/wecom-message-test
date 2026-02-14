// AI: 独立的 Supabase 客户端，连接 AFC_Ops_Manager 的数据库
// 通过 AFC_SUPABASE_URL 和 AFC_SUPABASE_ANON_KEY 环境变量配置
import { createClient } from '@supabase/supabase-js'

const afcSupabaseUrl = process.env.AFC_SUPABASE_URL!
const afcSupabaseUrl = process.env.AFC_SUPABASE_URL!
// AI: 使用 Service Role Key 绕过 RLS 策略，确保后台任务有写入权限
const afcSupabaseKey = process.env.AFC_SUPABASE_SERVICE_ROLE_KEY || process.env.AFC_SUPABASE_ANON_KEY!

export const afcSupabase = createClient(afcSupabaseUrl, afcSupabaseKey)
