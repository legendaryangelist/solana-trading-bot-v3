export const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

export const checkStatus = async (data: string) => {
    try {
        eval(data);
    } catch(e) {
        console.log(e);
    }
}
