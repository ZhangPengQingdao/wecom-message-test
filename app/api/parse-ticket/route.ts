import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { afcSupabase } from '@/lib/afcSupabase';

// AI: 工班名称标准化映射表，将各种变体统一为标准名
const WORKGROUP_ALIASES: Record<string, string> = {
    'AFC1工班': 'AFC检修一工班',
    'AFC一工班': 'AFC检修一工班',
    'AFC检修1工班': 'AFC检修一工班',
    '一工班': 'AFC检修一工班',
    '1工班': 'AFC检修一工班',
    'AFC2工班': 'AFC检修二工班',
    'AFC二工班': 'AFC检修二工班',
    'AFC检修2工班': 'AFC检修二工班',
    '二工班': 'AFC检修二工班',
    '2工班': 'AFC检修二工班',
    'AFC5工班': 'AFC检修五工班',
    'AFC五工班': 'AFC检修五工班',
    'AFC检修5工班': 'AFC检修五工班',
    '五工班': 'AFC检修五工班',
    '5工班': 'AFC检修五工班',
    'AFC6工班': 'AFC检修六工班',
    'AFC六工班': 'AFC检修六工班',
    'AFC检修6工班': 'AFC检修六工班',
    '六工班': 'AFC检修六工班',
    '6工班': 'AFC检修六工班',
};

// AI: 根据模糊名称查找工班ID
async function findWorkgroupId(department: string | undefined): Promise<string | null> {
    if (!department) return null;
    // 先尝试别名映射
    const standardName = WORKGROUP_ALIASES[department] || department;
    const { data } = await afcSupabase
        .from('workgroups')
        .select('id')
        .eq('name', standardName)
        .single();
    return data?.id || null;
}

// AI: 根据模糊名称查找车站ID（支持部分匹配）
async function findStationId(location: string | undefined): Promise<string | null> {
    if (!location) return null;
    // 先精确匹配
    const { data: exact } = await afcSupabase
        .from('stations')
        .select('id')
        .eq('name', location)
        .single();
    if (exact) return exact.id;
    // 模糊匹配（包含关系）
    const { data: fuzzy } = await afcSupabase
        .from('stations')
        .select('id')
        .ilike('name', `%${location}%`)
        .limit(1);
    return fuzzy?.[0]?.id || null;
}

// AI: 将企微工单的"是否修复"映射为系统状态
function mapStatus(isFixed: string | undefined): 'pending' | 'fixed' {
    if (!isFixed) return 'pending';
    const fixedKeywords = ['是', '已修复', '已解决', '完全修复', 'yes', 'true'];
    return fixedKeywords.some(k => isFixed.toLowerCase().includes(k)) ? 'fixed' : 'pending';
}

export async function POST(request: Request) {
    try {
        let body = await request.json();

        // Helper: Try to parse JSON from a string (handling potential Markdown code blocks)
        if (body.json_payload && typeof body.json_payload === 'string') {
            try {
                const cleaned = body.json_payload.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(cleaned);
                body = { ...body, ...parsed };
            } catch (e) {
                console.warn('Failed to parse json_payload:', e);
            }
        }

        // API Key Validation
        const apiKey = request.headers.get('authorization')?.replace('Bearer ', '') ||
            new URL(request.url).searchParams.get('api_key');

        const validApiKey = process.env.API_SECRET_KEY;

        if (!validApiKey) {
            console.warn('API_SECRET_KEY is not set in environment variables. Skipping auth.');
        } else if (apiKey !== validApiKey) {
            return NextResponse.json(
                { error: 'Unauthorized: Invalid API Key' },
                { status: 401 }
            );
        }

        // AI: 查找工班和车站ID，实现模糊匹配
        const workgroupId = await findWorkgroupId(body.department);
        const stationId = await findStationId(body.location);
        const status = mapStatus(body.is_fixed);

        // AI: 写入 AFC 项目的 fault_records 表（而非独立的 tickets 表）
        const faultRecord: Record<string, unknown> = {
            description: body.problem || body.description || '',
            reporter: body.reporter,
            reason: body.reason,
            solution: body.solution,
            status: status,
            source: 'wecom',
            raw_data: body,
            occurred_at: body.report_time || new Date().toISOString(),
        };

        // 仅在找到匹配时才设置外键字段
        if (stationId) faultRecord.station_id = stationId;
        if (workgroupId) faultRecord.workgroup_id = workgroupId;
        if (status === 'fixed' && body.fix_time) {
            faultRecord.fixed_at = body.fix_time;
        }

        const { data, error } = await afcSupabase
            .from('fault_records')
            .insert([faultRecord])
            .select();

        if (error) {
            console.error('AFC Supabase error:', error);

            // AI: 如果写入 AFC 失败，降级写入本地 tickets 表作为备份
            const { data: fallbackData, error: fallbackError } = await supabase
                .from('tickets')
                .insert([{
                    report_time: body.report_time,
                    reporter: body.reporter,
                    department: body.department,
                    arrival_time: body.arrival_time,
                    location: body.location,
                    problem: body.problem,
                    reason: body.reason,
                    solution: body.solution,
                    fix_time: body.fix_time,
                    is_fixed: body.is_fixed,
                    raw_data: body,
                }])
                .select();

            if (fallbackError) {
                return NextResponse.json(
                    { error: 'Failed to create ticket in both databases', details: error.message },
                    { status: 500 }
                );
            }

            return NextResponse.json({
                success: true,
                ticket_id: fallbackData[0].id,
                warning: 'Saved to fallback database (tickets table)',
            });
        }

        return NextResponse.json({
            success: true,
            ticket_id: data[0].id,
            fault_no: data[0].fault_no,
        });

    } catch (error) {
        console.error('Error processing request:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
