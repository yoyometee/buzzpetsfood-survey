// === survey-api.ts ===
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS Headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

// ดึงค่าจาก Environment Variable อย่างถูกต้อง
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// สร้าง client supabase โดยใส่ key ตัวนี้เท่านั้นพอ (service role key)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ตรวจสอบ environment variable
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing environment variables:');
    console.error('SUPABASE_URL:', SUPABASE_URL ? 'Present' : 'Missing');
    console.error('SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? 'Present' : 'Missing');
    return jsonResponse({
      error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      envStatus: {
        SUPABASE_URL: !!SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY
      }
    }, 500);
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  console.log('📡 Received request:', req.method, action);

  try {
    switch(action) {
      case 'getPostCodeData': {
        console.log('🏢 Getting postcode data...');
        const data = await getPostCodeData();
        console.log('📊 Postcode data count:', data.length);
        return jsonResponse(data);
      }
      case 'checkDuplicate': {
        console.log('🔍 Checking for duplicates...');
        const checkData = await req.json();
        const data = await checkDuplicateRegistration(checkData);
        console.log('📋 Duplicate check result:', data);
        return jsonResponse(data);
      }
      case 'submitSurvey': {
        console.log('💾 Submitting survey...');
        const surveyData = await req.json();
        const result = await submitSurveyData(surveyData);
        console.log('📝 Survey submission result:', result);
        return jsonResponse(result);
      }
      default:
        console.error('❌ Invalid action:', action);
        return jsonResponse({ error: "Invalid action" }, 400);
    }
  } catch (error) {
    console.error('💥 Error in main handler:', error);
    return jsonResponse({
      error: 'Internal Server Error',
      message: error.message,
      stack: error.stack
    }, 500);
  }
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

// ===== ฟังก์ชันช่วยเหลือ =====

// ดึงข้อมูลรหัสไปรษณีย์
async function getPostCodeData() {
  const result = [];
  let from = 0;
  const batchSize = 1000;

  while(true) {
    const { data, error } = await supabase
      .from('postcodes')
      .select('postcode, subdistrict, district, province')
      .range(from, from + batchSize - 1);

    if (error) {
      console.error('Error loading postcodes:', error);
      break;
    }

    if (!data || data.length === 0) break;

    result.push(...data);

    if (data.length < batchSize) break;
    from += batchSize;
  }

  if (result.length === 0) {
    return []; // หรือเรียก fallback function ถ้ามี
  }

  return result.map((row) => [
    row.postcode,
    row.subdistrict,
    row.district,
    row.province
  ]);
}

// ตรวจสอบข้อมูลซ้ำในตาราง survey_responses โดยเช็ค phone และ email
async function checkDuplicateRegistration(data) {
  const { phone, email } = data;

  if (!phone && !email) {
    return { isDuplicate: false }; // ไม่มีข้อมูลตรวจสอบ
  }

  const query = [];
  if (phone) query.push(`phone.eq.${phone}`);
  if (email) query.push(`email.eq.${email}`);

  const filterStr = query.join(',');

  const { data: existing, error } = await supabase
    .from('survey_responses')
    .select('phone, email')
    .or(filterStr);

  if (error) {
    console.error('Error checking duplicates:', error);
    return { isDuplicate: false };
  }

  if (!existing || existing.length === 0) {
    return { isDuplicate: false };
  }

  return {
    isDuplicate: true,
    reason: "ข้อมูลซ้ำในระบบ"
  };
}

// บันทึกข้อมูลแบบสอบถาม
async function submitSurveyData(formData) {
  console.log('📝 Received form data:', JSON.stringify(formData));
  
  // ตรวจสอบข้อมูลสำคัญทีละฟิลด์
  const requiredFields = {
    firstName: formData.firstName,
    lastName: formData.lastName,
    phone: formData.phone,
    houseNumber: formData.houseNumber,
    province: formData.province,
    district: formData.district,
    subdistrict: formData.subdistrict
  };

  const missingFields = [];
  for (const [key, value] of Object.entries(requiredFields)) {
    if (!value || value.trim() === '') {
      missingFields.push(key);
    }
  }

  if (missingFields.length > 0) {
    console.error('❌ Missing required fields:', missingFields);
    return {
      success: false,
      message: `ข้อมูลไม่ครบ: ${missingFields.join(', ')}`,
      missingFields: missingFields
    };
  }

  try {
    const id = await generateID();
    console.log('📋 Generated ID:', id);

    const insertData = {
      survey_id: id,
      first_name: formData.firstName.trim(),
      last_name: formData.lastName.trim(),
      phone: formData.phone.trim(),
      house_number: formData.houseNumber.trim(),
      subdistrict: formData.subdistrict.trim(),
      district: formData.district.trim(),
      province: formData.province.trim(),
      postcode: formData.postcode ? formData.postcode.trim() : null,
      registration_date: new Date().toISOString(),
      status: 'ลงทะเบียนสำเร็จ',
      email: formData.email ? formData.email.trim() : null
    };

    console.log('💾 Inserting data:', JSON.stringify(insertData));

    const { data, error } = await supabase
      .from('survey_responses')
      .insert([insertData])
      .select(); // เพิ่ม select เพื่อดูข้อมูลที่บันทึกแล้ว

    if (error) {
      console.error('❌ Insert error details:', JSON.stringify(error));
      return {
        success: false,
        message: 'ไม่สามารถบันทึกข้อมูลได้',
        errorDetail: error.message,
        errorCode: error.code
      };
    }

    console.log('✅ Data inserted successfully:', data);
    return {
      success: true,
      message: 'บันทึกข้อมูลสำเร็จ',
      surveyId: id,
      insertedData: data
    };

  } catch (error) {
    console.error('❌ Unexpected error in submitSurveyData:', error);
    return {
      success: false,
      message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล',
      errorDetail: error.message
    };
  }
}

async function generateID() {
  const { data, error } = await supabase
    .from('survey_responses')
    .select('survey_id')
    .order('created_at', { ascending: false })
    .limit(1);

  let last = 'ATG00000000';

  if (error) {
    console.error('Error generating ID:', error);
  }

  if (data && data.length > 0 && data[0].survey_id) {
    last = data[0].survey_id;
  }

  const num = parseInt(last.replace('ATG', ''), 10) + 1;
  return `ATG${String(num).padStart(8, '0')}`;
}
