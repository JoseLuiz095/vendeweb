import { restFetch } from '../lib/supabaseRest';

export type MealItem = { name:string; group:string; amount:number; unit:'g'|'ml'|'unit'; weight_state:'raw'|'cooked'|'prepared'|'not_applicable'; household_measure:string; alternatives:string };
export type Meal = { day:string; name:string; time:string; instructions:string; seasonings:string; items:MealItem[] };
export type NutritionPlan = { id:string; student_user_id:string; title:string; valid_until:string; meals:Meal[]; reported_restrictions:string; notes:string; status:'draft'|'approved'|'revoked'; professional_name?:string; registration?:string; previous_version_id?:string|null };
export const nutritionApi = {
  list:(store:string,token?:string)=>restFetch<NutritionPlan[]>('rpc/food_fitness_nutrition_list_v1',{method:'POST',token,body:{p_store:store}}),
  save:(store:string,plan:NutritionPlan)=>restFetch<{id:string}>('rpc/food_fitness_nutrition_save_v1',{method:'POST',body:{p_store:store,p_id:plan.id||null,p_student:plan.student_user_id,p_title:plan.title,p_valid_until:plan.valid_until,p_meals:plan.meals,p_restrictions:plan.reported_restrictions,p_notes:plan.notes}}),
  approve:(store:string,id:string)=>restFetch<unknown>('rpc/food_fitness_nutrition_approve_v1',{method:'POST',body:{p_store:store,p_plan:id}}),
};
