import { NextResponse } from 'next/server';
import { afcSupabase } from '@/lib/afcSupabase';

// AI: 企微工作流 → 创建待办事项 API
// 接收大模型拆分的参数，按车站区间创建待办任务（工班隔离）

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // AI: API Key 验证已移除，接口仅通过企微内部调用

        // 必填参数校验
        const { title, userid, username } = body;
        if (!title) {
            return NextResponse.json({ error: '缺少 title 参数' }, { status: 400 });
        }

        // 1. 用户匹配逻辑 (优先级: userid > username > test_user)
        let targetUser = null;

        // A. 尝试通过 userid 匹配
        if (userid) {
            const { data } = await afcSupabase
                .from('users')
                .select('id, name, workgroup_id')
                .eq('wecom_userid', userid)
                .single();
            if (data) targetUser = data;
        }

        // B. 尝试通过 username 匹配 (如果 userid 没匹配到)
        if (!targetUser && username) {
            const { data } = await afcSupabase
                .from('users')
                .select('id, name, workgroup_id')
                .eq('name', username)
                .single();
            if (data) targetUser = data;
        }

        // C. Fallback: 使用管理员账号 (只在以上都失败时)
        if (!targetUser) {
            const { data } = await afcSupabase
                .from('users')
                .select('id, name, workgroup_id')
                .eq('name', '管理员')
                .single();
            if (data) targetUser = data;
        }

        if (!targetUser) {
            return NextResponse.json({
                error: '未找到匹配的系统用户',
                detail: `无法识别用户身份。userid="${userid}", username="${username}" 均未匹配，且无默认测试用户。`
            }, { status: 404 });
        }

        const user = targetUser; // 统一变量名

        // 2. 解析车站范围
        let stationIds: string[] = [];
        const {
            start_station,
            end_station,
            station_names,
            line,
            description
        } = body;

        // AI: 智能车站解析 — 支持三种模式
        const hasSeparator = start_station && /[、,，]/.test(start_station);

        if (hasSeparator) {
            // A. 列表模式 — start_station 包含顿号/逗号分隔的多个站名
            const names = start_station.split(/[、,，]/).map((s: string) => s.trim()).filter(Boolean);
            stationIds = await resolveStationNames(names, user.workgroup_id);
        } else if (start_station && end_station) {
            // B. 区间模式 — 查找起止站之间的所有车站（本工班）
            stationIds = await resolveStationRange(
                start_station,
                end_station,
                line || null,
                user.workgroup_id
            );
        } else if (start_station && !end_station) {
            // C. 单站模式 — 只传了 start_station
            stationIds = await resolveStationNames([start_station], user.workgroup_id);
        } else if (station_names && Array.isArray(station_names)) {
            // D. 原有列表模式（兼容）
            stationIds = await resolveStationNames(station_names, user.workgroup_id);
        }

        if (stationIds.length === 0) {
            return NextResponse.json({
                error: '未匹配到任何车站',
                detail: `在本工班负责范围内未找到指定车站。start="${start_station}", end="${end_station}"`,
                user_workgroup: user.workgroup_id
            }, { status: 404 });
        }

        // 3. 去重检查：同一用户 5 分钟内不重复创建相同标题的待办
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: existingTask } = await afcSupabase
            .from('todo_tasks')
            .select('id, title, created_at')
            .eq('creator_id', user.id)
            .eq('title', title)
            .gte('created_at', fiveMinAgo)
            .limit(1);

        if (existingTask && existingTask.length > 0) {
            // AI: 检测到重复，返回已有任务信息而非报错
            return NextResponse.json({
                success: true,
                task_id: existingTask[0].id,
                title: title,
                creator: user.name,
                message: `待办已存在（${existingTask[0].created_at}），未重复创建`,
                deduplicated: true
            });
        }

        // 4. 创建待办任务
        const { data: task, error: taskError } = await afcSupabase
            .from('todo_tasks')
            .insert({
                title: title,
                description: description || null,
                task_type: 'general',
                scope_type: 'station',
                workgroup_id: user.workgroup_id,
                creator_id: user.id,
                status: 'in_progress'
            })
            .select()
            .single();

        if (taskError) {
            console.error('Create todo_task error:', taskError);
            return NextResponse.json({
                error: '创建任务失败',
                detail: taskError.message
            }, { status: 500 });
        }

        // 4. 为每个车站创建待办子项
        const items = stationIds.map(stationId => ({
            task_id: task.id,
            target_station_id: stationId,
            status: 'pending'
        }));

        const { error: itemsError } = await afcSupabase
            .from('todo_items')
            .insert(items);

        if (itemsError) {
            console.error('Create todo_items error:', itemsError);
            // 回滚：删除已创建的主任务
            await afcSupabase.from('todo_tasks').delete().eq('id', task.id);
            return NextResponse.json({
                error: '创建子项失败',
                detail: itemsError.message
            }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            task_id: task.id,
            title: title,
            station_count: stationIds.length,
            creator: user.name,
            message: `已创建待办：${title}，共 ${stationIds.length} 个车站`
        });

    } catch (error) {
        console.error('Create Todo Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// AI: 区间查询 — 根据起止站名和 sort_order 查出区间内所有车站
async function resolveStationRange(
    startName: string,
    endName: string,
    line: string | null,
    workgroupId: string
): Promise<string[]> {
    // 查找起止站（支持模糊匹配，去"站"后缀）
    const startClean = startName.replace(/站$/, '');
    const endClean = endName.replace(/站$/, '');

    // AI: 查出起止站的 sort_order 和所属线路
    const { data: endpoints } = await afcSupabase
        .from('stations')
        .select('id, name, line, sort_order, alias')
        .or(`name.ilike.%${startClean}%,name.ilike.%${endClean}%,alias.ilike.%${startClean}%,alias.ilike.%${endClean}%`);

    if (!endpoints || endpoints.length < 2) {
        return [];
    }

    // 匹配起止站
    const matchStation = (name: string) => {
        const clean = name.replace(/站$/, '');
        return endpoints.find(s =>
            s.name.includes(clean) || clean.includes(s.name.replace(/站$/, '')) ||
            (s.alias && (s.alias.includes(clean) || clean.includes(s.alias)))
        );
    };

    const startStation = matchStation(startName);
    const endStation = matchStation(endName);

    if (!startStation || !endStation) return [];

    // 确定线路（优先使用参数指定的，否则取起止站共同线路）
    const targetLine = line || startStation.line;
    if (!targetLine) return [];

    // 计算 sort_order 范围
    const minOrder = Math.min(startStation.sort_order!, endStation.sort_order!);
    const maxOrder = Math.max(startStation.sort_order!, endStation.sort_order!);

    // AI: 查询区间内、本工班负责的车站
    const { data: stations } = await afcSupabase
        .from('stations')
        .select('id')
        .eq('line', targetLine)
        .eq('workgroup_id', workgroupId)
        .gte('sort_order', minOrder)
        .lte('sort_order', maxOrder)
        .order('sort_order', { ascending: true });

    return (stations || []).map(s => s.id);
}

// AI: 列表匹配 — 逐一匹配车站名称
async function resolveStationNames(
    names: string[],
    workgroupId: string
): Promise<string[]> {
    const ids: string[] = [];

    for (const name of names) {
        const clean = name.replace(/站$/, '');
        const { data } = await afcSupabase
            .from('stations')
            .select('id')
            .eq('workgroup_id', workgroupId)
            .or(`name.ilike.%${clean}%,alias.ilike.%${clean}%`)
            .limit(1);

        if (data && data.length > 0) {
            ids.push(data[0].id);
        }
    }

    return ids;
}
