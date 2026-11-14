// Legacy consumers use the same server calculation and versioned write as FinanceWorkspace.
import {portal,currentMonth} from '@/portal/api';
import {normalizePayoutStatus,normalizeStatus} from '@/utils/helpers';
import {telegramFileUrl} from './actsApi';
import type {FinanceReport} from '@/workspace/finance';
export async function fetchPayouts(){
 const r=await portal<FinanceReport>('office.finance',{month:currentMonth(),export:true});
 return r.rows.map(row=>({id:row.id,applicationNumber:row.application_number,contractorName:row.contractor_name,contractorPhone:row.contractor_phone,amount:row.amount,payoutStatus:normalizePayoutStatus(row.payout_status),paidAt:row.paid_at,receiptFileId:row.payout_receipt_file_id,receiptType:row.payout_receipt_type,receiptName:row.payout_receipt_name,receiptUrl:row.payout_receipt_file_id?telegramFileUrl(row.payout_receipt_file_id):null,applicationTitle:row.title,applicationAddress:row.address,applicationStatus:normalizeStatus(row.status),version:row.payout_version}));
}
export type PayoutItem=Awaited<ReturnType<typeof fetchPayouts>>[number];
export async function confirmPayout(applicationId:string,version:number):Promise<void>{await portal('office.finance_confirm',{application:applicationId,version});}
