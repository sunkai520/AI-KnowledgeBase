import { reactive } from "vue"
//此处需要是个函数 若不是函数是对象的话,那就是多个页面使用一套分页.每次引用修改值都会导致其他页面分页值被修改
export default function (getList:Function,options:any) {
    //分页相关配置
    const pageConfig = reactive({
        page: 1,
        pageSize: options?.pageSize||10,
        loading: false,
        pageSizes: options?.pageSizes||[10, 20, 50,100,200],
        total: 0,
    })
    //每页展示多少条
    let handleSizeChange = (val) => {
        pageConfig.page = 1;
        pageConfig.pageSize = val;
        getList&&getList();
    };
    //页码发生变化
    let handleCurrentChange = (val = 1) => {
        pageConfig.page = val;
        getList&&getList();
    };
    return {
        pageConfig,
        handleSizeChange,
        handleCurrentChange,
    }
}
