package in.vasavi.vtc.common;

public class ApiException extends RuntimeException {

    private final String code;
    private final int status;

    public ApiException(String code) {
        this(code, 400);
    }

    public ApiException(String code, int status) {
        super(code);
        this.code = code;
        this.status = status;
    }

    public String getCode() {
        return code;
    }

    public String getDetail() {
        return code;
    }

    public int getStatus() {
        return status;
    }
}
