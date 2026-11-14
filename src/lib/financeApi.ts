import {portal,currentMonth} from '@/portal/api';
import type {FinanceStats,FinanceDailyPoint,FinanceTopContractor} from '@/types';
import type {FinanceReport} from '@/workspace/finance';
export const fetchFinanceReport=()=>portal<FinanceReport>('office.finance',{month:currentMonth()});
export async function fetchFinanceStats():Promise<FinanceStats>{
 const {stats:s}=await fetchFinanceReport();return {accruedToday:s.accrued_today,accruedThisMonth:s.accrued_month,paidThisMonth:s.paid_month,pendingPayout:s.debt_total,totalDebt:s.debt_total};
}
export async function fetchFinanceDaily(days=30):Promise<FinanceDailyPoint[]>{
 const r=await fetchFinanceReport(),start=new Date();start.setDate(start.getDate()-days);return r.daily.filter(p=>p.date>=start.toISOString().slice(0,10));
}
export async function fetchFinanceTopContractors():Promise<FinanceTopContractor[]>{
 const r=await fetchFinanceReport();return r.contractors.filter(c=>c.contractor_id).map(c=>({id:c.contractor_id!,name:c.contractor_name,totalPayout:c.paid,payoutCount:c.paid_count})).sort((a,b)=>b.totalPayout-a.totalPayout).slice(0,10);
}
