// AI: 独立的 Supabase 客户端，连接 AFC_Ops_Manager 的数据库
// 通过 AFC_SUPABASE_URL 和 AFC_SUPABASE_ANON_KEY 环境变量配置
import { createClient } from '@supabase/supabase-js'

const afcSupabaseUrl = process.env.AFC_SUPABASE_URL!
const afcSupabaseKey = process.env.AFC_SUPABASE_ANON_KEY!

export const afcSupabase = createClient(afcSupabaseUrl, afcSupabaseKey)
