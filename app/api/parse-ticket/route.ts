import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
    try {
        const body = await request.json();

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

        // Insert into Supabase tickets table
        const { data, error } = await supabase
            .from('tickets')
            .insert([
                {
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
                },
            ])
            .select();

        if (error) {
            console.error('Supabase error:', error);
            return NextResponse.json(
                { error: 'Failed to create ticket', details: error.message },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true, ticket_id: data[0].id });

    } catch (error) {
        console.error('Error processing request:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
