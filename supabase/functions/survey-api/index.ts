import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_KEY')!

interface SurveyData {
  firstName: string
  lastName: string
  gender: string
  birthDay: string
  birthMonth: string
  birthYear: string
  occupation: string
  occupationOther?: string
  monthlyIncome: string
  villageOrBuilding?: string
  houseNumber: string
  moo?: string
  soi?: string
  road?: string
  province: string
  district: string
  subdistrict: string
  postcode: string
  phone: string
  email: string
  petType: string
  petCount: string
  currentBrand: string
  currentBrandOther?: string
  receiptUpload?: string
  reasonNotBuyBuzz?: string
  monthlyExpense: string
  marketingChannel: string
  marketingChannelOther?: string
  importantFactors?: string
  improvementSuggestions?: string
  sampleProduct: string
  terms1: boolean
  terms2: boolean
  terms3: boolean
  receiptFile?: any
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    switch (action) {
      case 'getPostCodeData':
        return await getPostCodeData(supabase)
      
      case 'checkDuplicate':
        const checkData = await req.json()
        return await checkDuplicateRegistration(supabase, checkData)
      
      case 'submitSurvey':
        const surveyData = await req.json()
        return await submitSurveyData(supabase, surveyData)
      
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
    }
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

async function getPostCodeData(supabase: any) {
  try {
    console.log('Fetching postcode data...')
    const { data, error } = await supabase
      .from('postcodes')
      .select('postcode, subdistrict, district, province')
      .order('province', { ascending: true })

    if (error) {
      console.error('Supabase error:', error)
      throw error
    }

    console.log('Postcode data received:', data?.length || 0, 'records')

    // Convert to array format like original Google Sheets
    const formattedData = data.map((row: any) => [
      row.postcode,
      row.subdistrict,
      row.district,
      row.province
    ])

    console.log('Formatted data ready:', formattedData.length, 'records')

    return new Response(
      JSON.stringify(formattedData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Failed to get postcode data:', error)
    throw new Error(`Failed to get postcode data: ${error.message}`)
  }
}

async function checkDuplicateRegistration(supabase: any, data: any) {
  try {
    const {
      firstName,
      lastName,
      phone,
      email,
      villageOrBuilding,
      houseNumber,
      moo,
      soi,
      road,
      province,
      district,
      subdistrict,
      postcode
    } = data

    // สร้างที่อยู่เต็มรูปแบบ
    const fullAddress = createFullAddress(
      villageOrBuilding,
      houseNumber,
      moo,
      soi,
      road,
      subdistrict,
      district,
      province,
      postcode
    )

    // ตรวจสอบข้อมูลซ้ำ
    const { data: existingRecords, error } = await supabase
      .from('survey_responses')
      .select('*')

    if (error) throw error

    // ตรวจสอบตามลำดับความสำคัญ
    for (const record of existingRecords) {
      // 1. ตรวจสอบเบอร์โทร
      const cleanedPhone = cleanPhoneNumber(phone)
      const existingPhone = cleanPhoneNumber(record.phone)
      
      if (cleanedPhone && existingPhone) {
        if (cleanedPhone === existingPhone) {
          return new Response(
            JSON.stringify({ 
              isDuplicate: true, 
              reason: "เบอร์โทรซ้ำ (เบอร์โทร 1 เบอร์ ใช้ได้แค่ 1 ครั้ง)" 
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }

      // 2. ตรวจสอบอีเมล
      if (email && record.email && 
          cleanForComparison(email) === cleanForComparison(record.email)) {
        return new Response(
          JSON.stringify({ 
            isDuplicate: true, 
            reason: "อีเมลซ้ำ (อีเมลเดียวกันห้ามใช้ซ้ำ)" 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // 3. ตรวจสอบชื่อ-นามสกุล
      if (firstName && lastName && record.first_name && record.last_name) {
        if (cleanForComparison(firstName) === cleanForComparison(record.first_name) &&
            cleanForComparison(lastName) === cleanForComparison(record.last_name)) {
          return new Response(
            JSON.stringify({ 
              isDuplicate: true, 
              reason: "ชื่อและนามสกุลซ้ำกัน (ไม่สามารถลงทะเบียนซ้ำได้)" 
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }

      // 4. ตรวจสอบที่อยู่
      const existingFullAddress = createFullAddress(
        record.village_or_building,
        record.house_number,
        record.moo,
        record.soi,
        record.road,
        record.subdistrict,
        record.district,
        record.province,
        record.postcode
      )

      if (areAddressesSimilar(fullAddress, existingFullAddress)) {
        return new Response(
          JSON.stringify({ 
            isDuplicate: true, 
            reason: "ที่อยู่นี้ถูกลงทะเบียนแล้ว (ไม่ซ้ำบ้านเดียวกัน 1 บ้าน / 1 สิทธิ์)" 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    return new Response(
      JSON.stringify({ isDuplicate: false, reason: "" }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    throw new Error(`Failed to check duplicate: ${error.message}`)
  }
}

async function submitSurveyData(supabase: any, formData: SurveyData) {
  try {
    // ตรวจความถูกต้องของข้อมูล
    if (!formData.firstName || !formData.lastName || !formData.phone || !formData.houseNumber) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "กรุณากรอกข้อมูลสำคัญให้ครบถ้วน โดยเฉพาะชื่อ นามสกุล เบอร์โทร และบ้านเลขที่"
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // สร้าง ID ใหม่
    const uniqueID = await generateUniqueID(supabase)
    
    // จัดการอัปโหลดรูปภาพ
    let imageUrls: string[] = []
    if (formData.receiptFile) {
      imageUrls = await saveMultipleImagesToDrive(supabase, formData.receiptFile, uniqueID)
    }

    // เตรียมข้อมูลสำหรับบันทึก
    const insertData = {
      survey_id: uniqueID,
      first_name: formData.firstName,
      last_name: formData.lastName,
      gender: formData.gender,
      birth_day: formData.birthDay,
      birth_month: formData.birthMonth,
      birth_year: formData.birthYear,
      occupation: formData.occupation,
      occupation_other: formData.occupationOther || '',
      monthly_income: formData.monthlyIncome,
      village_or_building: formData.villageOrBuilding || '',
      house_number: formData.houseNumber,
      moo: formData.moo || '',
      soi: formData.soi || '',
      road: formData.road || '',
      province: formData.province,
      district: formData.district,
      subdistrict: formData.subdistrict,
      postcode: formData.postcode,
      phone: formData.phone,
      email: formData.email,
      pet_type: formData.petType,
      pet_count: formData.petCount,
      current_brand: formData.currentBrand,
      current_brand_other: formData.currentBrandOther || '',
      receipt_upload: formData.receiptUpload || '',
      reason_not_buy_buzz: formData.reasonNotBuyBuzz || '',
      monthly_expense: formData.monthlyExpense,
      marketing_channel: formData.marketingChannel,
      marketing_channel_other: formData.marketingChannelOther || '',
      receipt_file: formData.receiptFile ? 'Yes' : 'No',
      image_urls: imageUrls.join('\n'),
      important_factors: formData.importantFactors || '',
      improvement_suggestions: formData.improvementSuggestions || '',
      sample_product: formData.sampleProduct,
      terms1: formData.terms1,
      terms2: formData.terms2,
      terms3: formData.terms3,
      registration_date: new Date().toISOString(),
      notes: '',
      status: 'ลงทะเบียนสำเร็จ'
    }

    // บันทึกข้อมูลลงฐานข้อมูล
    const { error } = await supabase
      .from('survey_responses')
      .insert([insertData])

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, message: 'บันทึกข้อมูลเรียบร้อยแล้ว' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error submitting survey:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + error.message 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function generateUniqueID(supabase: any): Promise<string> {
  try {
    // ดึง ID ล่าสุด
    const { data, error } = await supabase
      .from('survey_responses')
      .select('survey_id')
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) throw error

    let lastID = "ATG00000000"
    if (data && data.length > 0) {
      lastID = data[0].survey_id
    }

    // ถ้าไม่มี ID เริ่มต้น ให้สร้างใหม่
    if (!lastID || !lastID.startsWith("ATG")) {
      lastID = "ATG00000000"
    }

    // แยกส่วนตัวเลขจาก ID
    const numPart = parseInt(lastID.substring(3), 10)
    const newNumPart = numPart + 1
    const newNumPartStr = String(newNumPart).padStart(8, '0')

    return "ATG" + newNumPartStr
  } catch (error) {
    throw new Error(`Failed to generate unique ID: ${error.message}`)
  }
}

async function saveMultipleImagesToDrive(supabase: any, filesData: any, uniqueID: string): Promise<string[]> {
  const imageUrls: string[] = []
  
  try {
    const files = Array.isArray(filesData) ? filesData : [filesData]
    
    for (let index = 0; index < files.length; index++) {
      const fileData = files[index]
      
      // แปลง base64 เป็น Uint8Array
      const byteCharacters = atob(fileData.data)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const uint8Array = new Uint8Array(byteNumbers)
      
      // สร้างชื่อไฟล์
      const fileExt = fileData.name.split('.').pop()
      const fileName = files.length > 1 
        ? `${uniqueID}_receipt_${index + 1}.${fileExt}`
        : `${uniqueID}_receipt.${fileExt}`
      
      // อัปโหลดไฟล์ไปยัง Supabase Storage
      const { data, error } = await supabase.storage
        .from('survey-images')
        .upload(fileName, uint8Array, {
          contentType: fileData.type,
          upsert: true
        })
      
      if (error) throw error
      
      // สร้าง public URL
      const { data: urlData } = supabase.storage
        .from('survey-images')
        .getPublicUrl(fileName)
      
      imageUrls.push(urlData.publicUrl)
    }
    
    return imageUrls
  } catch (error) {
    console.error('Error saving images:', error)
    return []
  }
}

// Helper functions (เหมือนเดิมจากโค้ด Google Apps Script)
function cleanPhoneNumber(phone: string): string {
  if (!phone) return ''
  
  let cleaned = String(phone).trim()
  cleaned = cleaned.replace(/[^\d]/g, '')
  
  if (cleaned.startsWith('66') && cleaned.length >= 10) {
    cleaned = '0' + cleaned.substring(2)
  }
  
  return cleaned
}

function cleanForComparison(text: string): string {
  if (!text) return ''
  
  let cleaned = String(text).trim()
  cleaned = cleaned.toLowerCase().replace(/\s+/g, ' ')
  
  return cleaned
}

function createFullAddress(
  villageOrBuilding?: string,
  houseNumber?: string,
  moo?: string,
  soi?: string,
  road?: string,
  subdistrict?: string,
  district?: string,
  province?: string,
  postcode?: string
): string {
  let parts: string[] = []
  
  if (houseNumber) parts.push("บ้านเลขที่ " + houseNumber)
  if (moo) parts.push("หมู่ " + moo)
  if (villageOrBuilding) parts.push(villageOrBuilding)
  if (soi) parts.push("ซอย " + soi)
  if (road) parts.push("ถนน " + road)
  if (subdistrict) parts.push("ตำบล " + subdistrict)
  if (district) parts.push("อำเภอ " + district)
  if (province) parts.push("จังหวัด " + province)
  if (postcode) parts.push(postcode)
  
  return parts.join(" ")
}

function areAddressesSimilar(address1: string, address2: string): boolean {
  if (!address1 || !address2) return false
  
  const cleanedAddress1 = cleanForComparison(address1)
  const cleanedAddress2 = cleanForComparison(address2)
  
  if (cleanedAddress1 === cleanedAddress2) return true
  
  // Add more sophisticated address comparison logic here
  // For now, use simple string similarity
  const similarity = calculateSimilarity(cleanedAddress1, cleanedAddress2)
  return similarity > 0.9
}

function calculateSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0
  
  const longer = s1.length > s2.length ? s1 : s2
  const shorter = s1.length > s2.length ? s2 : s1
  
  if (longer.length === 0) return 1.0
  
  const editDistance = levenshteinDistance(longer, shorter)
  return (longer.length - editDistance) / longer.length
}

function levenshteinDistance(s1: string, s2: string): number {
  const costs: number[] = []
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j
      } else if (j > 0) {
        let newValue = costs[j - 1]
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1
        }
        costs[j - 1] = lastValue
        lastValue = newValue
      }
    }
    if (i > 0) {
      costs[s2.length] = lastValue
    }
  }
  return costs[s2.length]
}
