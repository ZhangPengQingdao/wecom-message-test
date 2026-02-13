import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { afcSupabase } from '@/lib/afcSupabase';

// AI: 工班名称标准化映射表
const WORKGROUP_ALIASES: Record<string, string> = {
    'AFC1工班': 'AFC检修一工班', 'AFC一工班': 'AFC检修一工班', 'AFC检修1工班': 'AFC检修一工班', '一工班': 'AFC检修一工班', '1工班': 'AFC检修一工班',
    'AFC2工班': 'AFC检修二工班', 'AFC二工班': 'AFC检修二工班', 'AFC检修2工班': 'AFC检修二工班', '二工班': 'AFC检修二工班', '2工班': 'AFC检修二工班',
    'AFC3工班': 'AFC检修三工班', 'AFC三工班': 'AFC检修三工班', 'AFC检修3工班': 'AFC检修三工班', '三工班': 'AFC检修三工班', '3工班': 'AFC检修三工班',
    'AFC4工班': 'AFC检修四工班', 'AFC四工班': 'AFC检修四工班', 'AFC检修4工班': 'AFC检修四工班', '四工班': 'AFC检修四工班', '4工班': 'AFC检修四工班',
    'AFC5工班': 'AFC检修五工班', 'AFC五工班': 'AFC检修五工班', 'AFC检修5工班': 'AFC检修五工班', '五工班': 'AFC检修五工班', '5工班': 'AFC检修五工班',
    'AFC6工班': 'AFC检修六工班', 'AFC六工班': 'AFC检修六工班', 'AFC检修6工班': 'AFC检修六工班', '六工班': 'AFC检修六工班', '6工班': 'AFC检修六工班',
};

// AI: 根据模糊名称查找工班ID
async function findWorkgroupId(department: string | undefined): Promise<string | null> {
    if (!department) return null;
    const standardName = WORKGROUP_ALIASES[department] || department;
    const { data } = await afcSupabase
        .from('workgroups')
        .select('id')
        .eq('name', standardName)
        .single();
    return data?.id || null;
}

// AI: 结构化解析故障地点 -> 车站 + 设备类型 + 设备编号
async function parseLocationInfo(location: string | undefined): Promise<{
    stationId: string | null;
    deviceTypeId: string | null;
    deviceNumber: string | null;
    extraInfo: string;
}> {
    if (!location) return { stationId: null, deviceTypeId: null, deviceNumber: null, extraInfo: '' };

    try {
        // 0. 并行获取元数据 (缓存策略: 实时查询，量级较小)
        const [stationsRes, deviceTypesRes] = await Promise.all([
            afcSupabase.from('stations').select('id, name, line').limit(200),
            afcSupabase.from('device_types').select('id, name, code').limit(50)
        ]);

        const stations = stationsRes.data || [];
        const deviceTypes = deviceTypesRes.data || [];

        // 1. 尝试识别线路 (用于多线换乘站的消歧)
        let targetLine: string | null = null;
        if (location.includes('1号线') || location.includes('一号线')) targetLine = '1号线';
        else if (location.includes('13号线') || location.includes('十三号线') || location.includes('西海岸')) targetLine = '西海岸快线';
        else if (location.includes('6号线') || location.includes('六号线')) targetLine = '6号线';

        // 2. 匹配车站
        let stationId: string | null = null;

        // 预处理: 移除"站"后缀并按长度降序排序 (优先匹配长名, 如"安子东"优于"安子")
        // 如果识别到线路，优先排在该线路的车站
        const candidates = stations.map(s => ({
            ...s,
            cleanName: s.name.replace(/站$/, '')
        })).sort((a, b) => {
            if (targetLine) {
                const aLineMatch = a.line === targetLine ? 1 : 0;
                const bLineMatch = b.line === targetLine ? 1 : 0;
                if (aLineMatch !== bLineMatch) return bLineMatch - aLineMatch;
            }
            return b.cleanName.length - a.cleanName.length;
        });

        for (const s of candidates) {
            // 支持 "沟岔" 匹配 "沟岔站"
            if (location.includes(s.cleanName) || location.includes(s.name)) {
                stationId = s.id;
                break;
            }
        }

        // 3. 匹配设备类型
        // AI: 别名映射，包含 TVMI/TVMII 等实际 code
        let deviceTypeId: string | null = null;
        let matchedDeviceKeyword: string | null = null; // 记录匹配到的关键词，用于提取编号

        const typeAliases: Record<string, string[]> = {
            'TVMI': ['TVMI', 'TVM1', 'TVMⅠ', '全功能售票机', '全功能自动售票机'],
            'TVMII': ['TVMII', 'TVM2', 'TVMⅡ', '非全功能售票机', '非全功能自动售票机'],
            'TVM': ['TVM', '售票机', '自动售票机', '购票机'],
            'AGM': ['AGM', '闸机', '检票机', '自动检票机', '进出站闸机'],
            'BOM': ['BOM', '半自动', '客服中心', '半自动售票机']
        };

        // AI: 按 code 长度降序排列，避免 "TVMI" 被 "TVM" 抢先匹配
        const sortedDeviceTypes = [...deviceTypes].sort((a, b) =>
            (b.code?.length || 0) - (a.code?.length || 0)
        );

        for (const dt of sortedDeviceTypes) {
            if (dt.code) {
                const aliases = typeAliases[dt.code] || [dt.name];
                if (!aliases.includes(dt.code)) aliases.push(dt.code);

                // 不区分大小写匹配，优先匹配长关键词
                const sortedAliases = [...aliases].sort((a, b) => b.length - a.length);
                for (const alias of sortedAliases) {
                    if (location.toUpperCase().includes(alias.toUpperCase())) {
                        deviceTypeId = dt.id;
                        matchedDeviceKeyword = alias;
                        break;
                    }
                }
                if (deviceTypeId) break;
            }
        }

        // 4. 提取设备编号
        // AI: 不再盲目取第一个数字，而是在设备类型关键词后面提取
        let deviceNumber: string | null = null;

        if (matchedDeviceKeyword) {
            // 在 location 中找到关键词位置，取其后面的数字
            const upperLoc = location.toUpperCase();
            const keywordIdx = upperLoc.indexOf(matchedDeviceKeyword.toUpperCase());
            if (keywordIdx >= 0) {
                const afterKeyword = location.slice(keywordIdx + matchedDeviceKeyword.length);
                const numMatch = afterKeyword.match(/^[- _]?(\d+)/);
                if (numMatch) {
                    let num = numMatch[1];
                    if (num.length === 1) num = '0' + num;
                    deviceNumber = num;
                }
            }
        }

        // 如果没有通过设备类型关键词提取到编号，尝试备用方案
        // 排除线路号 (1号线/6号线/13号线) 后的独立数字
        if (!deviceNumber) {
            const cleaned = location
                .replace(/\d+号线/g, '')   // 移除 "13号线"
                .replace(/[一二三四五六七八九十]+号线/g, ''); // 移除 "十三号线"
            const fallbackMatch = cleaned.match(/(\d+)/);
            if (fallbackMatch) {
                let num = fallbackMatch[1];
                if (num.length === 1) num = '0' + num;
                deviceNumber = num;
            }
        }

        return {
            stationId,
            deviceTypeId,
            deviceNumber,
            extraInfo: '' // 保留字段
        };

    } catch (e) {
        console.error('Parse Location Error:', e);
        return { stationId: null, deviceTypeId: null, deviceNumber: null, extraInfo: '' };
    }
}

function mapStatus(isFixed: string | undefined): 'pending' | 'fixed' {
    if (!isFixed) return 'pending';
    const fixedKeywords = ['是', '已修复', '已解决', '完全修复', 'yes', 'true'];
    return fixedKeywords.some(k => isFixed.toLowerCase().includes(k)) ? 'fixed' : 'pending';
}

function normalizeTimestamp(timeStr: string | undefined | null): string {
    if (!timeStr || timeStr.trim() === '') {
        return new Date().toISOString();
    }
    const trimmed = timeStr.trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
        const today = new Date().toISOString().split('T')[0];
        return `${today}T${trimmed}:00+08:00`;
    }
    return trimmed;
}

export async function POST(request: Request) {
    try {
        let body = await request.json();

        // Handle nested JSON string
        if (body.json_payload && typeof body.json_payload === 'string') {
            try {
                const cleaned = body.json_payload.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(cleaned);
                body = { ...body, ...parsed };
            } catch (e) {
                console.warn('Failed to parse json_payload:', e);
            }
        }

        // AI: API Key 验证已移除，接口仅通过企微内部调用

        // AI: 中文→英文字段映射 (企微工作流传中文字段名)
        const fieldMap: Record<string, string> = {
            '故障地点': 'location',
            '故障现象': 'problem',
            '故障原因': 'reason',
            '处置措施': 'solution',
            '接报人': 'reporter',
            '所属工班': 'department',
            '接报时间': 'report_time',
            '修复时间': 'fix_time',
            '到达时间': 'arrival_time',
            '是否完全修复': 'is_fixed',
        };
        for (const [cn, en] of Object.entries(fieldMap)) {
            if (body[cn] !== undefined && body[en] === undefined) {
                body[en] = body[cn];
            }
        }

        // AI: 数据解析
        const workgroupId = await findWorkgroupId(body.department);
        const { stationId, deviceTypeId, deviceNumber } = await parseLocationInfo(body.location);
        const status = mapStatus(body.is_fixed);
        const description = body.problem || body.description || '（企微工单，无故障描述）';

        // AI: 基于时间和内容的去重
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: existing } = await afcSupabase
            .from('fault_records')
            .select('id')
            .eq('source', 'wecom')
            .eq('description', description)
            .eq('reporter', body.reporter || '')
            .gte('created_at', fiveMinAgo)
            .limit(1);

        if (existing && existing.length > 0) {
            return NextResponse.json({
                success: true,
                ticket_id: existing[0].id,
                deduplicated: true,
                message: 'Duplicate ticket skipped'
            });
        }

        // AI: 构造记录
        const faultRecord: Record<string, unknown> = {
            description: description,
            reporter: body.reporter || null,
            reason: body.reason || null,
            solution: body.solution || null,
            status: status,
            source: 'wecom',
            raw_data: body,
            occurred_at: normalizeTimestamp(body.report_time),
        };

        if (stationId) faultRecord.station_id = stationId;
        if (workgroupId) faultRecord.workgroup_id = workgroupId;
        if (deviceTypeId) faultRecord.device_type_id = deviceTypeId;
        if (deviceNumber) faultRecord.device_number = deviceNumber;

        if (status === 'fixed' && body.fix_time) {
            faultRecord.fixed_at = normalizeTimestamp(body.fix_time);
        }

        const { data, error } = await afcSupabase
            .from('fault_records')
            .insert([faultRecord])
            .select();

        if (error) {
            console.error('AFC Insert Error:', error);
            // Fallback
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

            if (fallbackError) return NextResponse.json({ error: 'DB Insert Failed' }, { status: 500 });

            return NextResponse.json({
                success: true,
                ticket_id: fallbackData[0].id,
                warning: 'Saved to fallback tickets table'
            });
        }

        return NextResponse.json({
            success: true,
            ticket_id: data[0].id,
            fault_no: data[0].fault_no,
        });

    } catch (error) {
        console.error('Handler Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
